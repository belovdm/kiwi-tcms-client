export interface PageResult<T = unknown> {
  total: number;
  shown: number;
  rows: T[];
}

export interface ListLimit {
  limit?: number;
}
