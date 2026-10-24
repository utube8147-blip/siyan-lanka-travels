// Shared by every screen that loads a list from the database.
/**
 * Every row of a query, page by page. The API returns at most 1,000 rows per
 * request, so a single request silently drops the rest once there are more
 * bookings than that (staff lists and cash totals would quietly be short).
 */
export async function fetchAllRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<{ data: T[]; error: { message: string } | null }> {
  const SIZE = 1000;
  const all: T[] = [];
  for (let from = 0; from < 200_000; from += SIZE) {
    const { data, error } = await page(from, from + SIZE - 1);
    if (error) return { data: all, error };
    all.push(...(data ?? []));
    if (!data || data.length < SIZE) break;
  }
  return { data: all, error: null };
}

