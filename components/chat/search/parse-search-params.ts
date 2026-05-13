export type HasFilter = "files" | "links" | null;
export type SortMode = "newest" | "oldest";

export type SearchState = {
  q: string;
  in: string | null;
  from: string | null;
  before: string | null;
  after: string | null;
  has: HasFilter;
  sort: SortMode;
};

export const EMPTY_STATE: SearchState = {
  q: "",
  in: null,
  from: null,
  before: null,
  after: null,
  has: null,
  sort: "newest",
};

export function parseSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): SearchState {
  const get = (key: string): string | null => {
    if (params instanceof URLSearchParams) {
      return params.get(key);
    }
    const v = params[key];
    if (Array.isArray(v)) return v[0] ?? null;
    return v ?? null;
  };

  const has = get("has");
  const sort = get("sort");

  return {
    q: get("q") ?? "",
    in: get("in"),
    from: get("from"),
    before: get("before"),
    after: get("after"),
    has: has === "files" || has === "links" ? has : null,
    sort: sort === "oldest" ? "oldest" : "newest",
  };
}

export function stringifySearchState(state: SearchState): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.in) params.set("in", state.in);
  if (state.from) params.set("from", state.from);
  if (state.before) params.set("before", state.before);
  if (state.after) params.set("after", state.after);
  if (state.has) params.set("has", state.has);
  if (state.sort !== "newest") params.set("sort", state.sort);
  const s = params.toString();
  return s ? `?${s}` : "";
}
