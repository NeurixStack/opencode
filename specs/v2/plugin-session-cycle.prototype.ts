/**
 * Prototype: plugin Session API dependency patterns.
 *
 * Run from repo root with:
 *
 *   bun specs/v2/plugin-session-cycle.prototype.ts
 *
 * The first case recreates the stripped-down cycle. The second case is the first
 * working version: PluginService stays in the location runtime, but it no longer
 * constructs PluginHost. A global PluginSupervisor constructs the host after it
 * can see both Session and a concrete location runtime.
 */

type NodeName =
  | "App"
  | "Session"
  | "LocationSession"
  | "LocationServiceMap"
  | "LocationRuntime"
  | "InstanceState"
  | "PluginService"
  | "PluginHost"
  | "PluginInternal"
  | "PluginSupervisor"
  | "SDK"
  | "ToolDomain"

type Graph = Readonly<Record<NodeName, readonly NodeName[]>>

const empty: Graph = {
  App: [],
  Session: [],
  LocationSession: [],
  LocationServiceMap: [],
  LocationRuntime: [],
  InstanceState: [],
  PluginService: [],
  PluginHost: [],
  PluginInternal: [],
  PluginSupervisor: [],
  SDK: [],
  ToolDomain: [],
}

/**
 * RED: current shape if ctx.session is added to the host PluginService builds.
 *
 * Walkthrough:
 * - App needs Session and LocationServiceMap.
 * - Session needs LocationServiceMap for APIs like prompt/revert that route to a location.
 * - LocationServiceMap builds LocationRuntime.
 * - LocationRuntime builds PluginService.
 * - PluginService builds PluginHost.
 * - PluginHost now wants Session for ctx.session.
 */
const currentPluginOwnsHost: Graph = {
  ...empty,
  App: ["Session", "LocationServiceMap"],
  Session: ["LocationServiceMap"],
  LocationServiceMap: ["LocationRuntime"],
  LocationRuntime: ["PluginService", "PluginInternal", "ToolDomain"],
  PluginService: ["PluginHost"],
  PluginHost: ["Session", "ToolDomain"],
  PluginInternal: ["PluginService"],
}

/**
 * GREEN v1: host construction moves out of PluginService.
 *
 * PluginService remains per-location, but is only lifecycle/scope ownership.
 * PluginSupervisor is app/global. It loads configured plugins for a location by:
 * - reading Session for ctx.session
 * - asking LocationServiceMap for that location runtime
 * - building PluginHost from those concrete capabilities
 * - asking the location PluginService to own the plugin scope
 *
 * LocationRuntime no longer needs PluginHost or PluginInternal while it is being
 * constructed, so Session can route through LocationServiceMap without looping
 * back into Session.
 */
const supervisorOwnsHost: Graph = {
  ...empty,
  App: ["Session", "LocationServiceMap", "PluginSupervisor"],
  Session: ["LocationServiceMap"],
  LocationServiceMap: ["LocationRuntime"],
  LocationRuntime: ["PluginService", "ToolDomain"],
  PluginService: [],
  PluginSupervisor: ["Session", "LocationServiceMap", "PluginHost", "PluginService"],
  PluginHost: ["Session", "ToolDomain"],
}

/**
 * GREEN v2: split location-sensitive functions into a location service.
 *
 * Session is global data: create/get/list/messages/etc. It does not route into
 * LocationServiceMap. LocationSession is built inside the location runtime and
 * owns prompt/revert/other operations that touch location services.
 *
 * PluginHost can combine Session + LocationSession into one ctx.session surface,
 * while the graph still obeys: location services may depend on global services,
 * but global services do not depend on location services.
 */
const locationSessionOperations: Graph = {
  ...empty,
  App: ["Session", "LocationServiceMap"],
  LocationServiceMap: ["LocationRuntime"],
  LocationRuntime: ["PluginService", "PluginHost", "LocationSession", "ToolDomain"],
  PluginService: [],
  PluginHost: ["Session", "LocationSession", "ToolDomain"],
  LocationSession: ["Session", "ToolDomain"],
}

/**
 * GREEN but cursed: all services are global and read the active location from
 * InstanceState. This removes LocationServiceMap from the construction graph.
 *
 * The cost is that location correctness becomes ambient: every operation must
 * trust that InstanceState currently points at the session's location, or add
 * runtime assertions to catch a wrong ambient location.
 */
const allGlobalInstanceState: Graph = {
  ...empty,
  App: ["InstanceState", "Session", "PluginService", "ToolDomain"],
  Session: ["InstanceState"],
  PluginService: ["PluginHost"],
  PluginHost: ["Session", "ToolDomain", "InstanceState"],
  ToolDomain: ["InstanceState"],
}

/**
 * GREEN v3: SDK as one plugin instance.
 *
 * The SDK does not install a location-specific plugin or write a global tool
 * registry. It receives the same PluginHost context as any plugin instance, and
 * its methods are wrappers over that host. When plugins are booted per location,
 * this SDK-backed plugin instance contributes normal location-local transforms.
 */
const sdkAsPluginInstance: Graph = {
  ...empty,
  App: ["Session", "LocationServiceMap"],
  LocationServiceMap: ["LocationRuntime"],
  LocationRuntime: ["PluginService", "PluginHost", "LocationSession", "ToolDomain", "SDK"],
  PluginService: [],
  PluginHost: ["Session", "LocationSession", "ToolDomain"],
  SDK: ["PluginHost"],
  LocationSession: ["Session", "ToolDomain"],
}

expectCycle("current PluginService owns PluginHost with ctx.session", currentPluginOwnsHost)
assertAcyclic("supervisor owns PluginHost; PluginService is lifecycle only", supervisorOwnsHost)
assertAcyclic("location Session operations; globals do not route down", locationSessionOperations)
assertAcyclic("all-global services with InstanceState ambient location", allGlobalInstanceState)
assertAcyclic("SDK is a plugin instance that calls PluginHost", sdkAsPluginInstance)

function expectCycle(name: string, graph: Graph) {
  const cycle = findCycle(graph)
  if (!cycle) throw new Error(`expected red but got green: ${name}`)
  console.log(`red as expected: ${name}`)
  console.log(`cycle: ${cycle.join(" -> ")}`)
}

function assertAcyclic(name: string, graph: Graph) {
  const cycle = findCycle(graph)
  if (!cycle) {
    console.log(`green: ${name}`)
    return
  }
  throw new Error(`red: ${name}\ncycle: ${cycle.join(" -> ")}`)
}

function findCycle(graph: Graph) {
  const visiting = new Set<NodeName>()
  const visited = new Set<NodeName>()
  const stack: NodeName[] = []

  const visit = (node: NodeName): NodeName[] | undefined => {
    if (visiting.has(node)) return [...stack.slice(stack.indexOf(node)), node]
    if (visited.has(node)) return

    visiting.add(node)
    stack.push(node)

    for (const next of graph[node]) {
      const cycle = visit(next)
      if (cycle) return cycle
    }

    stack.pop()
    visiting.delete(node)
    visited.add(node)
    return
  }

  for (const node of Object.keys(graph) as NodeName[]) {
    const cycle = visit(node)
    if (cycle) return cycle
  }

  return
}
