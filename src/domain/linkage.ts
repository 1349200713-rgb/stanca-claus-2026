import type { SizeCode } from "./types";

export type Marketplace = "US";

export interface ProductIdentity {
  marketplace: Marketplace;
  asin: string;
  sku: string;
  size: SizeCode;
  productName?: string;
}

export interface TrafficRecord {
  key: string;
  marketplace: Marketplace;
  date: string;
  asin: string;
  sku?: string;
  sessions: number | null;
  pageViews?: number | null;
  orders?: number | null;
}

export interface CompetitorSnapshot {
  id: string;
  marketplace: Marketplace;
  date: string;
  competitorAsin: string;
  brand?: string;
  productName?: string;
  size?: string;
  isOwnProduct?: boolean;
  price: number | null;
  effectivePrice?: number | null;
  couponPercent?: number | null;
  couponAmount?: number | null;
  codePercent?: number | null;
  codePrice?: number | null;
  primeSavings?: string | null;
  dealActive?: boolean | null;
  rating?: number | null;
  reviewCount?: number | null;
  bsrRank?: number | null;
  categoryRank?: number | null;
  subcategoryRank?: number | null;
  estimatedUnits?: number | null;
  stockStatus?: string | null;
  colorStyle?: string;
  source?: string;
  note?: string;
  updatedAt: string;
}

export type RankStatus = "ranked" | "notIndexed" | "missing";

export interface KeywordRankSnapshot {
  id: string;
  marketplace: Marketplace;
  date: string;
  keywordId: string;
  keyword: string;
  asin: string;
  organicRank: number | null;
  adRank: number | null;
  organicStatus: RankStatus;
  adStatus: RankStatus;
  competitorAsin?: string;
  page?: number | null;
  source?: string;
  note?: string;
  updatedAt: string;
}

export interface LinkedFilter {
  startDate: string;
  endDate: string;
  marketplace: Marketplace;
  asin?: string;
  sku?: string;
  size?: SizeCode;
  keywordId?: string;
  competitorAsin?: string;
}

export interface FunnelMetrics {
  ctr: number | null;
  cpc: number | null;
  cvr: number | null;
  adCvr: number | null;
  acos: number | null;
  tacos: number | null;
  organicOrders: number | null;
  conflicts: string[];
}
