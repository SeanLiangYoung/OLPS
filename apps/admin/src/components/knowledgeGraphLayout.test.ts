import { describe, expect, it } from 'vitest'
import { graphSpawnCenter, mergeGraphLayoutNodes } from './knowledgeGraphLayout'

describe('knowledgeGraphLayout', () => {
  it('保留已有节点坐标，并在重心附近放置新节点', () => {
    const merged = mergeGraphLayoutNodes(
      [
        { id: 'a', label: 'A', type: 'source', path: 'wiki/a.md', linkCount: 1 },
        { id: 'b', label: 'B', type: 'entity', path: 'wiki/b.md', linkCount: 2 },
      ],
      [{ id: 'a', x: 100, y: 200, vx: 1, vy: 2 }],
      { x: 100, y: 200 },
      () => 0.5,
    )
    expect(merged).toEqual([
      {
        id: 'a',
        label: 'A',
        type: 'source',
        path: 'wiki/a.md',
        linkCount: 1,
        x: 100,
        y: 200,
        vx: 1,
        vy: 2,
        r: expect.any(Number),
        isNew: false,
      },
      {
        id: 'b',
        label: 'B',
        type: 'entity',
        path: 'wiki/b.md',
        linkCount: 2,
        x: 100,
        y: 200,
        r: expect.any(Number),
        isNew: true,
      },
    ])
  })

  it('按已有节点计算新节点出生重心', () => {
    expect(
      graphSpawnCenter(
        [
          { x: 0, y: 0 },
          { x: 100, y: 50 },
        ],
        { x: 10, y: 10 },
      ),
    ).toEqual({ x: 50, y: 25 })
    expect(graphSpawnCenter([], { x: 10, y: 10 })).toEqual({ x: 10, y: 10 })
  })
})
