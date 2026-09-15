export interface WeeklyPromotionPlanRow {
  startDate: string;
  endDate: string;
  phase: string;
  weeklyTargetUnits: number;
  targetDailyUnits: number;
  targetConversionRate: string;
  targetAdOrderShare: string;
  targetAcos: string;
  targetPrice: string;
  plannedAdBudget?: string;
  plannedSales?: string;
  offsitePlan: string;
  operationFocus: string;
  reviewPlan: string;
}

export interface DailyPromotionPlanRow extends WeeklyPromotionPlanRow {
  date: string;
}

export const weeklyPromotionPlanRows: WeeklyPromotionPlanRow[] = [
  { startDate: "2026-10-02", endDate: "2026-10-08", phase: "启动测试", weeklyTargetUnits: 21, targetDailyUnits: 3, targetConversionRate: "5%", targetAdOrderShare: "30%", targetAcos: "35%", targetPrice: "$57.99", plannedAdBudget: "$127.87", plannedSales: "$1,217.79", offsitePlan: "—", operationFocus: "SP自动+SP大词广泛+精准+ASIN定位；对比去年listing的点击和转化数据", reviewPlan: "补评价：3单" },
  { startDate: "2026-10-09", endDate: "2026-10-15", phase: "测试收敛", weeklyTargetUnits: 28, targetDailyUnits: 4, targetConversionRate: "6%", targetAdOrderShare: "28%", targetAcos: "30%", targetPrice: "$59.99", plannedAdBudget: "$141.10", plannedSales: "$1,679.72", offsitePlan: "—", operationFocus: "SP自动+SP大词广泛+精准+ASIN定位+品类捡漏", reviewPlan: "补评价：3单" },
  { startDate: "2026-10-16", endDate: "2026-10-22", phase: "起量验证", weeklyTargetUnits: 35, targetDailyUnits: 5, targetConversionRate: "7%", targetAdOrderShare: "25%", targetAcos: "28%", targetPrice: "$61.99", plannedAdBudget: "$151.88", plannedSales: "$2,169.65", offsitePlan: "—", operationFocus: "增加大词预算；小预算测试SB/SBV；增加其它尺码的手动关键词投放", reviewPlan: "补评价：3单" },
  { startDate: "2026-10-23", endDate: "2026-10-29", phase: "起量验证", weeklyTargetUnits: 56, targetDailyUnits: 8, targetConversionRate: "8%", targetAdOrderShare: "23%", targetAcos: "28%", targetPrice: "$62.99", plannedAdBudget: "$227.17", plannedSales: "$3,527.44", offsitePlan: "—", operationFocus: "SP预算集中核心词；对稳定尺码小幅提价；根据出单词增加核心词的投放", reviewPlan: "补评价：3单" },
  { startDate: "2026-10-30", endDate: "2026-11-05", phase: "盈利前检查", weeklyTargetUnits: 160, targetDailyUnits: 22.9, targetConversionRate: "9%", targetAdOrderShare: "22%", targetAcos: "25%", targetPrice: "$62.99", plannedAdBudget: "$554.31", plannedSales: "$10,078.40", offsitePlan: "站外：60-80单Attribution 跟踪数据站外价格不要低于黑五价格$56.99", operationFocus: "做站外前三天广告增加预算20%-30%；重点观察：核心词曝光和点击是否增加；CPC是否异常上涨；广告订单与自然订单是否同步增长；Listing转化率是否明显下降", reviewPlan: "待定" },
  { startDate: "2026-11-06", endDate: "2026-11-12", phase: "盈利放量", weeklyTargetUnits: 350, targetDailyUnits: 50, targetConversionRate: "10%", targetAdOrderShare: "20%", targetAcos: "22%", targetPrice: "$65.99", plannedAdBudget: "$1,016.25", plannedSales: "$23,096.50", offsitePlan: "站外：60-80单Attribution 跟踪数据站外价格不要低于黑五价格$56.99", operationFocus: "盈利期提价主窗口；提升自然单占比，均价拉到20%毛利安全线以上", reviewPlan: "—" },
  { startDate: "2026-11-13", endDate: "2026-11-19", phase: "盈利放量", weeklyTargetUnits: 490, targetDailyUnits: 70, targetConversionRate: "11%", targetAdOrderShare: "18%", targetAcos: "22%", targetPrice: "$65.99", plannedAdBudget: "$1,280.47", plannedSales: "$32,335.10", offsitePlan: "黑五网一 活动时段：11 月 19 日 — 11 月 30 日；前后 12 天大促窗口", operationFocus: "增加SB视频投放", reviewPlan: "—" },
  { startDate: "2026-11-20", endDate: "2026-11-26", phase: "主利润期", weeklyTargetUnits: 840, targetDailyUnits: 120, targetConversionRate: "12%", targetAdOrderShare: "16%", targetAcos: "20%", targetPrice: "$65.99", plannedAdBudget: "$1,773.81", plannedSales: "$55,431.60", offsitePlan: "黑五网一 活动时段：11 月 19 日 — 11 月 30 日；前后 12 天大促窗口", operationFocus: "视情况而定", reviewPlan: "—" },
  { startDate: "2026-11-27", endDate: "2026-12-03", phase: "黑五网一", weeklyTargetUnits: 360, targetDailyUnits: 51.4, targetConversionRate: "12%", targetAdOrderShare: "16%", targetAcos: "22%", targetPrice: "$63.99", plannedAdBudget: "$810.88", plannedSales: "$23,036.40", offsitePlan: "黑五网一 活动时段：11 月 19 日 — 11 月 30 日；前后 12 天大促窗口", operationFocus: "视情况而定", reviewPlan: "—" },
  { startDate: "2026-12-04", endDate: "2026-12-09", phase: "大促后承接", weeklyTargetUnits: 200, targetDailyUnits: 33.3, targetConversionRate: "11%", targetAdOrderShare: "15%", targetAcos: "20%", targetPrice: "$65.99", plannedAdBudget: "$395.94", plannedSales: "$13,198.00", offsitePlan: "—", operationFocus: "12/9前继续保利润；清货启动前目标仅剩100件左右", reviewPlan: "—" },
  { startDate: "2026-12-10", endDate: "2026-12-13", phase: "盈利收口", weeklyTargetUnits: 350, targetDailyUnits: 87.5, targetConversionRate: "10%", targetAdOrderShare: "12%", targetAcos: "22%", targetPrice: "$65.99", plannedAdBudget: "$609.75", plannedSales: "$23,096.50", offsitePlan: "—", operationFocus: "12/10启动清货；剩余加Coupon/降价；停止排名型广告", reviewPlan: "—" },
  { startDate: "2026-12-14", endDate: "2026-12-18", phase: "清货启动", weeklyTargetUnits: 84, targetDailyUnits: 16.8, targetConversionRate: "9%", targetAdOrderShare: "10%", targetAcos: "25%", targetPrice: "$55.99", plannedAdBudget: "$117.58", plannedSales: "$4,703.16", offsitePlan: "—", operationFocus: "12/14后按尺码库存强清，砍低效广告；目标剩余≤100", reviewPlan: "—" },
  { startDate: "2026-12-19", endDate: "2026-12-22", phase: "清尾货", weeklyTargetUnits: 26, targetDailyUnits: 6.5, targetConversionRate: "7%", targetAdOrderShare: "8%", targetAcos: "15%", targetPrice: "$52.99", plannedAdBudget: "$16.53", plannedSales: "$1,377.74", offsitePlan: "—", operationFocus: "12/19后仅处理尾货和售后；不再主动追排名", reviewPlan: "—" },
];

function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const finish = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= finish) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function buildDailyPromotionPlan(rows: readonly WeeklyPromotionPlanRow[] = weeklyPromotionPlanRows): DailyPromotionPlanRow[] {
  return rows.flatMap((row) => datesBetween(row.startDate, row.endDate).map((date) => ({ ...row, date })));
}
