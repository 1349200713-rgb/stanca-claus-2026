import type { SizeCode } from "./types";

export interface DailyPlanRow {
  date: string;
  size: SizeCode;
  units: number;
}

export interface ActivePlan {
  id: "plan-2026";
  rows: DailyPlanRow[];
  totalUnits: number;
  updatedAt: string;
}

export interface PlanChange {
  id: string;
  changedAt: string;
  reason: string;
  beforeTotal: number;
  afterTotal: number;
}

export interface InventorySnapshot {
  key: string;
  date: string;
  size: SizeCode;
  fbaAvailable: number;
  reserved: number | null;
  unfulfillable: number | null;
  sourceImportKey: string;
}

export interface InboundEntry {
  size: SizeCode;
  units: number | null;
  expectedArrivalDate: string | null;
  updatedAt: string;
  fbaNumber?: string;
  unitPrice?: string;
  asin?: string;
  sku?: string;
  productName?: string;
  shipDate?: string | null;
}

export interface PromotionPlanOverride {
  key: string;
  date: string;
  phase?: string;
  weeklyTargetUnits?: number;
  lWeeklyUnits?: number;
  xlWeeklyUnits?: number;
  twoXlWeeklyUnits?: number;
  threeXlWeeklyUnits?: number;
  targetDailyUnits?: number;
  cumulativeTargetUnits?: number;
  targetConversionRate?: string;
  targetAdOrderShare?: string;
  targetAcos?: string;
  targetPrice?: string;
  plannedProfit?: string;
  plannedEndingInventory?: number;
  plannedAdBudget?: string;
  plannedSales?: string;
  dailyAdBudget?: string;
  plannedPromotionReserve?: string;
  actualSales?: string;
  actualAdSpend?: string;
  actualAdSales?: string;
  actualAdOrders?: number;
  actualTotalOrders?: number;
  actualAdOrderShare?: string;
  actualAcos?: string;
  actualCvr?: string;
  actualProfitAfterAds?: string;
  profitRate?: string;
  offsitePlan?: string;
  offsiteOrders?: number;
  operationFocus?: string;
  reviewPlan?: string;
  reviewOrderNumber?: string;
  serviceProvider?: string;
  reviewQuantity?: number;
  weeklyConclusion?: string;
  nextAction?: string;
  note?: string;
  updatedAt: string;
}

export interface DailyOperationRecord {
  key: string;
  date: string;
  time?: string;
  action: string;
  risk: string;
  tomorrowPlan: string;
  status: "未完成" | "已完成";
  note?: string;
  category?: "调价" | "优惠券" | "广告预算" | "竞价" | "否词" | "关键词" | "Listing" | "站外推广" | "测评" | "库存" | "其他";
  priority?: "低" | "中" | "高";
  owner?: string;
  dueDate?: string;
  asin?: string;
  sku?: string;
  keywordId?: string;
  competitorAsin?: string;
  sourceAlertId?: string;
  effectStatus?: "待观察" | "有效" | "无明显变化" | "负向" | "数据不足";
  updatedAt: string;
}
