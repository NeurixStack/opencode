import { Schema } from "effect"

export function data<S extends Schema.Top>(schema: S) {
  return Schema.Struct({ data: schema })
}

export function make<A>(data: A) {
  return { data }
}
