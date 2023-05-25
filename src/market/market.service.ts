import { CACHE_MANAGER, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Cache } from 'cache-manager';
import * as moment from 'moment';
import { DataSource } from 'typeorm';
import { DB_SERVER } from '../constants';
import { SessionDatesInterface } from '../stock/interfaces/session-dates.interface';
import { UtilCommonTemplate } from '../utils/utils.common';
import { IPriceChangePerformance } from './interfaces/price-change-performance.interface';
import { RedisKeys } from '../enums/redis-keys.enum';
import * as _ from 'lodash';
import { PriceChangePerformanceResponse } from './responses/price-change-performance.response';
import { LiquidityChangePerformanceResponse } from './responses/liquidity-change-performance.response';
import { MssqlService } from '../mssql/mssql.service';
import { ExceptionResponse } from '../exceptions/common.exception';

@Injectable()
export class MarketService {
  constructor(
    @Inject(CACHE_MANAGER)
    private readonly redis: Cache,
    @InjectDataSource() private readonly db: DataSource,
    @InjectDataSource(DB_SERVER) private readonly dbServer: DataSource,
    private readonly mssqlService: MssqlService,
  ) {}

  //Get the nearest day have transaction in session, week, month...
  public async getSessionDate(
    table: string,
    column: string = 'date',
    instance: any = this.dbServer,
  ): Promise<SessionDatesInterface> {
    const redisData = await this.redis.get<SessionDatesInterface>(
      `${RedisKeys.SessionDate}:${table}:${column}`,
    );
    if (redisData) return redisData;

    const lastYear = moment().subtract('1', 'year').format('YYYY-MM-DD');
    const firstDateYear = moment().startOf('year').format('YYYY-MM-DD');
    const quarterDate = moment()
      .subtract(1, 'quarter')
      .endOf('quarter')
      .format('YYYY-MM-DD');

    const query: string = `
          WITH data as (
              SELECT DISTINCT TOP 5 [date]
              FROM ${table}
              WHERE [date] IS NOT NULL 
              ORDER BY [date] DESC
              UNION ALL
              SELECT TOP 1 [date]
              FROM ${table}
              WHERE [date] IS NOT NULL
              AND [date] <= @0
              ORDER BY [date] DESC
              UNION ALL
              SELECT TOP 1 [date]
              FROM ${table}
              WHERE [date] IS NOT NULL
              AND [date] >= @1
              ORDER BY [date]
              UNION ALL
              SELECT TOP 1 [date]
              FROM ${table}
              WHERE [date] IS NOT NULL
              AND [date] >= @2
              ORDER BY [date]
          )
          select * from data
        `;

    const data = await instance.query(query, [
      quarterDate,
      firstDateYear,
      lastYear,
    ]);

    const result = {
      latestDate: UtilCommonTemplate.toDate(data[0][column]),
      lastFiveDate: UtilCommonTemplate.toDate(data[4][column]),
      lastQuarterDate: UtilCommonTemplate.toDate(data[5][column]),
      firstYearDate: UtilCommonTemplate.toDate(data[6][column]),
      lastYearDate: UtilCommonTemplate.toDate(data[7][column]),
    };

    await this.redis.set(`${RedisKeys.SessionDate}:${table}:${column}`, result);
    return result;
  }

  async priceChangePerformance(ex: string, industries: string[]) {
    const floor = ex == 'ALL' ? ` ('HOSE', 'HNX', 'UPCOM') ` : ` ('${ex}') `;
    const {
      latestDate,
      lastFiveDate,
      lastQuarterDate,
      firstYearDate,
      lastYearDate,
    } = await this.getSessionDate('[marketTrade].dbo.tickerTradeVND');

    const inds: string = UtilCommonTemplate.getIndustryFilter(industries);

    const query: string = `
      select
          other.date, other.code,
          (now.closePrice - other.closePrice) / nullif(other.closePrice, 0) * 100 as perChange
      from (
          select [date], t.code, closePrice
          from [marketTrade].dbo.tickerTradeVND t
          inner join [marketInfor].dbo.info i
          on i.code = t.code
          where [date] = '${latestDate}' and i.LV2 in ${inds}
              and i.floor in ${floor} and i.type in ('STOCK', 'ETF')
      ) as now
      inner join (
              select [date], t.code, closePrice
          from [marketTrade].dbo.tickerTradeVND t
          inner join [marketInfor].dbo.info i
          on i.code = t.code
          where [date] in ('${lastFiveDate}', '${lastQuarterDate}', '${firstYearDate}', '${lastYearDate}') 
          and i.LV2 in ${inds}
              and i.floor in ${floor} and i.type in ('STOCK', 'ETF')
      ) as other
      on now.date > other.date and now.code = other.code
      group by other.date, other.code, now.closePrice, other.closePrice
      order by perChange desc, other.code, other.date desc
    `;

    const data = await this.dbServer.query(query);

    const mappedData: IPriceChangePerformance[] =
      UtilCommonTemplate.transformData([...data], {
        latestDate,
        lastFiveDate,
        lastQuarterDate,
        firstYearDate,
        lastYearDate,
      });

    return new PriceChangePerformanceResponse().mapToList(
      _.take(_.orderBy(mappedData, 'perFive', 'desc'), 50),
    );
  }

  async liquidityChangePerformance(ex: string, industries: string[]) {
    const floor = ex == 'ALL' ? ` ('HOSE', 'HNX', 'UPCOM') ` : ` ('${ex}') `;
    const inds: string = UtilCommonTemplate.getIndustryFilter(industries);

    const redisData = await this.redis.get(
      `${RedisKeys.LiquidityChangePerformance}:${floor}:${inds}`,
    );
    if (redisData) return redisData;

    const quarterDate = UtilCommonTemplate.getPastDate(5);
    const latestQuarterDate = quarterDate[0];
    const secondQuarterDate = quarterDate[1];
    const yearQuarterDate = quarterDate[4];
    const fourYearsDate = moment(new Date(latestQuarterDate))
      .subtract(4, 'years')
      .format('YYYY/MM/DD');
    const timeQuery: string = `
      WITH data as (
              SELECT TOP 1 [date]
              FROM [marketTrade].dbo.tickerTradeVND
              WHERE [date] IS NOT NULL
              AND [date] <= '${latestQuarterDate}'
              ORDER BY [date] DESC
              UNION ALL
              SELECT TOP 1 [date]
              FROM [marketTrade].dbo.tickerTradeVND
              WHERE [date] IS NOT NULL
              AND [date] <= '${secondQuarterDate}'
              ORDER BY [date] DESC
              UNION ALL
              SELECT TOP 1 [date]
              FROM [marketTrade].dbo.tickerTradeVND
              WHERE [date] IS NOT NULL
              AND [date] <= '${yearQuarterDate}'
              ORDER BY [date] DESC
              UNION ALL
              SELECT TOP 1 [date]
              FROM [marketTrade].dbo.tickerTradeVND
              WHERE [date] IS NOT NULL
              AND [date] <= '${fourYearsDate}'
              ORDER BY [date] DESC
          )
          select * from data
    `;

    const dates = await this.dbServer.query(timeQuery);

    const query: string = `
        select
        other.date, other.code,
            (now.totalVal - other.totalVal) / nullif(other.totalVal, 0) * 100 as perChange
        from (
            select [date], t.code, totalVal
            from [marketTrade].dbo.tickerTradeVND t
            inner join [marketInfor].dbo.info i
            on i.code = t.code
            where [date] = @0 and i.LV2 in ${inds}
                and i.floor in ${floor} and i.type in ('STOCK', 'ETF')
        ) as now
        inner join (
                select [date], t.code, totalVal
            from [marketTrade].dbo.tickerTradeVND t
            inner join [marketInfor].dbo.info i
            on i.code = t.code
            where [date] in (@1, @2, @3)
            and i.LV2 in ${inds}
                and i.floor in ${floor} and i.type in ('STOCK', 'ETF')
        ) as other
        on now.date > other.date and now.code = other.code
        group by other.date, other.code, now.totalVal, other.totalVal
        order by perChange desc, other.code, other.date desc;
    `;
    const correctDate = [
      ...dates.map((i) => UtilCommonTemplate.toDate(i.date)),
    ];
    const data = await this.dbServer.query(query, correctDate);

    const mappedData: IPriceChangePerformance[] =
      UtilCommonTemplate.transformDataLiquid([...data], {
        latestQuarterDate: correctDate[0],
        secondQuarterDate: correctDate[1],
        yearQuarterDate: correctDate[2],
        fourYearsDate: correctDate[3],
      });

    const result = new LiquidityChangePerformanceResponse().mapToList(
      _.take(_.orderBy(mappedData, 'perQuarter', 'desc'), 50),
    );

    await this.redis.set(
      `${RedisKeys.LiquidityChangePerformance}:${floor}:${inds}`,
      result,
    );

    return result;
  }

  async marketCapChangePerformance(
    ex: string,
    industries: string[],
    type: number,
  ) {
    const query: string = `
      SELECT
        now.date, now.code as floor,
        ((now.totalVal - prev.totalVal) / NULLIF(prev.totalVal, 0)) * 100 AS perChange
      FROM
        (
          SELECT
            [date],
            code,
            totalVal
          FROM [marketTrade].[dbo].[indexTrade]
          WHERE [date] >= @0
          AND [date] <= @1
          AND [code] in ('VNINDEX', 'HNXINDEX', 'UPINDEX')
        ) AS now
      INNER JOIN
        (
          SELECT
            [date],
            code,
            totalVal
          FROM [marketTrade].[dbo].[indexTrade]
          WHERE [date] = @0
          AND [code] in ('VNINDEX', 'HNXINDEX', 'UPINDEX')
        ) AS prev
      ON now.[date] > prev.[date] and now.code = prev.code
      GROUP BY now.[date], now.[code], prev.[date], now.totalVal, prev.totalVal
      ORDER BY now.[date] ASC;
    `;

    const data = await this.dbServer.query(query);
  }

  async indsLiquidityChangePerformance(
    ex: string,
    industries: string[],
    type: number,
  ) {
    const { latestDate, weekDate, monthDate, firstDateYear, yearDate } =
      await this.getSessionDate('[marketTrade].[dbo].[indexTrade]');

    let startDate!: any;
    switch (type) {
      case 2:
        startDate = weekDate;
        break;
      case 2:
        startDate = monthDate;
        break;
      case 2:
        startDate = firstDateYear;
        break;
      case 2:
        startDate = yearDate;
        break;
      default:
        throw new ExceptionResponse(HttpStatus.BAD_REQUEST, 'type not found');
    }

    const query: string = `
      SELECT
        now.date, now.industry,
        ((now.totalVal - prev.totalVal) / NULLIF(prev.totalVal, 0)) * 100 AS perChange
      FROM
        (
          SELECT
            [date],
            i.LV2 as industry,
            sum(totalVal) as totalVal
          FROM [marketTrade].[dbo].[tickerTradeVND] t
          inner join marketInfor.dbo.info i
          on t.code = i.code
          WHERE [date] in ('2023-05-12', '2023-05-15', '2023-05-24')
            and i.floor in ('HOSE')
            and i.type in ('STOCK', 'ETF')
            and i.LV2 != ''
          group by [date], i.LV2
        ) AS now
      INNER JOIN
        (
          SELECT
            [date],
            i.LV2 as industry,
            sum(totalVal) as totalVal
          FROM [marketTrade].[dbo].[tickerTradeVND] t
          inner join marketInfor.dbo.info i
          on t.code = i.code
          WHERE [date] = '2023-05-12'
            and i.floor in ('HOSE')
            and i.type in ('STOCK', 'ETF')
            and i.LV2 != ''
          group by [date], i.LV2
        ) AS prev
      ON now.[date] >= prev.[date] and now.industry = prev.industry
      GROUP BY now.[date], now.industry, prev.[date], now.totalVal, prev.totalVal
      ORDER BY now.[date]
    `;

    const data1 = await this.mssqlService.query(query);
    return data1;
  }
}
