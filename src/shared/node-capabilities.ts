/**
 * Declarative node capability registry.
 *
 * Each canvas node kind registers a descriptor of what an agent (or any
 * external caller) is allowed to read, write, and invoke. Agent-facing tools
 * stay fully generic: they query this registry instead of hardcoding node
 * knowledge. Adding a new node kind = one registerNodeCapabilities() call,
 * with zero changes to the IPC layer, canvas command handler, or agent tools.
 */

export interface FieldOption {
  value: string;
  label: string;
}

export type NodeFieldType = 'string' | 'number' | 'boolean' | 'enum' | 'string-array' | 'object';

export interface NodeFieldDescriptor {
  /** Key inside the node's data object, e.g. 'prompt' */
  key: string;
  type: NodeFieldType;
  description?: string;
  /** Static allowed values for type 'enum' */
  values?: string[];
  /** Allowed values for type 'number' (e.g. duration presets 5/10/15) */
  numberValues?: number[];
  /** Option provider id; values are resolved at query time (e.g. live workflow list) */
  dynamicOptions?: string;
  /** Read-only fields are reported in capabilities but rejected on write */
  readonly?: boolean;
}

export interface NodeActionDescriptor {
  /** Action id used by invoke-action, e.g. 'generate' */
  id: string;
  label: string;
  description?: string;
  /**
   * Async actions return an immediate ack; progress is polled through the
   * node's data field named by statusField until it leaves the busy state.
   */
  async?: boolean;
  statusField?: string;
}

export interface NodeCapabilityDescriptor {
  kind: string;
  label: string;
  fields: NodeFieldDescriptor[];
  actions: NodeActionDescriptor[];
}

/** Fields registered under this pseudo-kind apply to every node kind. */
export const SHARED_FIELDS_KIND = '*';

export type NodeOptionProvider =
  (field: NodeFieldDescriptor) => Promise<FieldOption[]> | FieldOption[];

const capabilityRegistry = new Map<string, NodeCapabilityDescriptor>();
const optionProviders = new Map<string, NodeOptionProvider>();

export function registerNodeCapabilities(descriptor: NodeCapabilityDescriptor): void {
  capabilityRegistry.set(descriptor.kind, descriptor);
}

export function registerOptionProvider(id: string, provider: NodeOptionProvider): void {
  optionProviders.set(id, provider);
}

const mergeSharedFields = (descriptor: NodeCapabilityDescriptor): NodeCapabilityDescriptor => {
  const shared = capabilityRegistry.get(SHARED_FIELDS_KIND);
  if (!shared || descriptor.kind === SHARED_FIELDS_KIND) return descriptor;
  const ownKeys = new Set(descriptor.fields.map((field) => field.key));
  return {
    ...descriptor,
    fields: [...shared.fields.filter((field) => !ownKeys.has(field.key)), ...descriptor.fields],
  };
};

/** List capabilities for all registered kinds (shared fields merged in). */
export function getNodeCapabilities(): NodeCapabilityDescriptor[];
/** Get the merged capability descriptor for one kind, or undefined. */
export function getNodeCapabilities(kind: string): NodeCapabilityDescriptor | undefined;
export function getNodeCapabilities(
  kind?: string,
): NodeCapabilityDescriptor[] | NodeCapabilityDescriptor | undefined {
  if (typeof kind === 'string') {
    const descriptor = capabilityRegistry.get(kind);
    return descriptor ? mergeSharedFields(descriptor) : undefined;
  }
  return [...capabilityRegistry.values()]
    .filter((descriptor) => descriptor.kind !== SHARED_FIELDS_KIND)
    .map(mergeSharedFields);
}

/** Look up a single field for a node kind (shared fields included). */
export function getCapabilityField(kind: string, key: string): NodeFieldDescriptor | undefined {
  return getNodeCapabilities(kind)?.fields.find((field) => field.key === key);
}

export async function resolveDynamicOptions(field: NodeFieldDescriptor): Promise<FieldOption[]> {
  if (!field.dynamicOptions) return [];
  const provider = optionProviders.get(field.dynamicOptions);
  if (!provider) return [];
  return provider(field);
}

/**
 * Validate a value against a field descriptor.
 * Returns an error message, or null when the value is acceptable.
 */
export function validateNodeFieldValue(field: NodeFieldDescriptor, value: unknown): string | null {
  switch (field.type) {
    case 'string':
      return typeof value === 'string' ? null : '需要字符串';
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return '需要数字';
      if (field.numberValues && !field.numberValues.includes(value)) {
        return `仅支持：${field.numberValues.join(', ')}`;
      }
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : '需要布尔值';
    case 'enum':
      if (typeof value !== 'string') return '需要字符串枚举值';
      // Dynamic options are validated by the provider's consumer, not here.
      if (field.values && !field.values.includes(value)) {
        return `仅支持：${field.values.join(', ')}`;
      }
      return null;
    case 'string-array':
      return Array.isArray(value) && value.every((item) => typeof item === 'string')
        ? null
        : '需要字符串数组';
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? null
        : '需要对象';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Node action handler registry (renderer-side). Node components register
// their live handlers (e.g. the generate button's function) keyed by
// node id + action id; the canvas command handler dispatches invoke-action
// requests through here.
// ---------------------------------------------------------------------------

export type NodeActionHandler =
  (params?: Record<string, unknown>) => void | Promise<unknown>;

const actionHandlers = new Map<string, NodeActionHandler>();

const actionKey = (nodeId: string, actionId: string) => `${nodeId}::${actionId}`;

/** Register a live action handler; returns an unregister function. */
export function registerNodeAction(
  nodeId: string,
  actionId: string,
  handler: NodeActionHandler,
): () => void {
  const key = actionKey(nodeId, actionId);
  actionHandlers.set(key, handler);
  return () => {
    if (actionHandlers.get(key) === handler) actionHandlers.delete(key);
  };
}

export function getNodeAction(nodeId: string, actionId: string): NodeActionHandler | undefined {
  return actionHandlers.get(actionKey(nodeId, actionId));
}

// ---------------------------------------------------------------------------
// Kind-level action handlers. Unlike per-node handlers (which live inside a
// node component and disappear when React Flow unmounts off-screen nodes),
// these are registered once per node kind and work for every node id,
// mounted or not. Prefer these for actions like "generate".
// ---------------------------------------------------------------------------

export type NodeKindActionHandler =
  (nodeId: string, params?: Record<string, unknown>) => void | Promise<unknown>;

const kindActionHandlers = new Map<string, NodeKindActionHandler>();

export function registerNodeKindAction(
  kind: string,
  actionId: string,
  handler: NodeKindActionHandler,
): () => void {
  const key = actionKey(kind, actionId);
  kindActionHandlers.set(key, handler);
  return () => {
    if (kindActionHandlers.get(key) === handler) kindActionHandlers.delete(key);
  };
}

export function getNodeKindAction(
  kind: string,
  actionId: string,
): NodeKindActionHandler | undefined {
  return kindActionHandlers.get(actionKey(kind, actionId));
}
