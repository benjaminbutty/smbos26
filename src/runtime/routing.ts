import { graphKeySchema } from "../core/graph/schemas";

export function experienceKeyToPath(key: string): string {
  return graphKeySchema.parse(key).replaceAll("_", "-");
}

export function experiencePathToKey(path: string): string {
  return graphKeySchema.parse(path.replaceAll("-", "_"));
}
