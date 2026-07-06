import { SearchExa } from "./exa"
import { SearchFirecrawl } from "./firecrawl"
import { SearchParallel } from "./parallel"

export const SearchPlugins = [SearchExa.Plugin, SearchFirecrawl.Plugin, SearchParallel.Plugin] as const
