/**
 * Dependency graph.
 *
 * Nodes are files, components, packages, routes, endpoints and models. Edges are
 * typed so that impact analysis and root-cause work can talk about *why* one
 * node depends on another rather than only *that* it does.
 */
import type { PlannedFile } from './manifest.js';

export type NodeKind = 'file' | 'component' | 'package' | 'route' | 'endpoint' | 'model' | 'application';

export interface GraphNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly label: string;
}

export type EdgeKind = 'imports' | 'uses-component' | 'declares-route' | 'calls-endpoint' | 'contains';

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
}

export interface DependencyGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export interface GraphAnalysis {
  readonly order: readonly string[];
  readonly cycles: readonly (readonly string[])[];
  readonly missing: readonly string[];
}

export function buildGraph(manifest: { files: readonly PlannedFile[] }): DependencyGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  const addNode = (node: GraphNode): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    nodes.push(node);
  };

  for (const file of manifest.files) {
    addNode({ id: file.path, kind: 'file', label: file.path });
    for (const imported of file.imports) {
      addNode({ id: imported, kind: 'file', label: imported });
      edges.push({ from: file.path, to: imported, kind: 'imports' });
    }
    for (const external of file.externalImports) {
      const packageName = external.startsWith('@') ? external.split('/').slice(0, 2).join('/') : (external.split('/')[0] ?? external);
      if (packageName === '' || packageName.startsWith('node:')) continue;
      addNode({ id: `package:${packageName}`, kind: 'package', label: packageName });
      edges.push({ from: file.path, to: `package:${packageName}`, kind: 'imports' });
    }
    for (const component of file.provenance.component === undefined ? [] : [file.provenance.component]) {
      addNode({ id: `component:${component}`, kind: 'component', label: component });
      edges.push({ from: `component:${component}`, to: file.path, kind: 'contains' });
    }
  }

  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  edges.sort((a, b) => (a.from === b.from ? (a.to < b.to ? -1 : 1) : a.from < b.from ? -1 : 1));
  return { nodes, edges };
}

/** Kahn topological sort; nodes in cycles are reported separately. */
export function analyzeGraph(graph: DependencyGraph): GraphAnalysis {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    indegree.set(node.id, indegree.get(node.id) ?? 0);
    adjacency.set(node.id, adjacency.get(node.id) ?? []);
  }
  for (const edge of graph.edges) {
    if (!indegree.has(edge.to)) {
      indegree.set(edge.to, 0);
      adjacency.set(edge.to, []);
    }
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    adjacency.get(edge.from)?.push(edge.to);
  }

  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id).sort();
  const order: string[] = [];
  const remaining = new Map(indegree);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const degree = (remaining.get(next) ?? 1) - 1;
      remaining.set(next, degree);
      if (degree === 0) {
        // Insertion keeps the order deterministic.
        const position = queue.findIndex((entry) => entry > next);
        if (position === -1) queue.push(next);
        else queue.splice(position, 0, next);
      }
    }
    remaining.delete(id);
  }

  const cycles: string[][] = [];
  const cycleNodes = [...remaining.keys()].sort();
  if (cycleNodes.length > 0) cycles.push(cycleNodes);

  const known = new Set(graph.nodes.map((node) => node.id));
  const missing = graph.edges.filter((edge) => !known.has(edge.to) || !known.has(edge.from)).map((edge) => `${edge.from} -> ${edge.to}`);

  return { order, cycles, missing };
}

/** Files that (transitively) import the given path. */
export function reverseDependencies(graph: DependencyGraph, id: string): string[] {
  const result = new Set<string>();
  let frontier = [id];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const edge of graph.edges) {
      if (frontier.includes(edge.to) && !result.has(edge.from)) {
        result.add(edge.from);
        next.push(edge.from);
      }
    }
    frontier = next;
  }
  return [...result].sort();
}
