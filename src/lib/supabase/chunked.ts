// .in('slide_id', [수백 개 UUID]) 한 방 쿼리는 URL 이 8KB 를 넘어 "URI too long" 으로
// 조용히 빈 결과가 된다(게이트웨이 한도. 실측: 212개=8.3KB 거부). 100개(≈4KB)씩 나눠 병렬 조회한다.
// 어떤 청크든 에러면 throw — 부분 결과를 정상처럼 돌려주지 않는다.
export async function selectInChunks<T>(
  ids: string[],
  fetch: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  chunkSize = 100,
): Promise<T[]> {
  if (!ids.length) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));
  const results = await Promise.all(chunks.map((chunk) => fetch(chunk)));
  const rows: T[] = [];
  for (const { data, error } of results) {
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}
