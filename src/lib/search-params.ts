export type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export async function readSearchParam(
  searchParams: SearchParams,
  name: string,
): Promise<string | undefined> {
  const value = (await searchParams)[name];
  return Array.isArray(value) ? value[0] : value;
}
