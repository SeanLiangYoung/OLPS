import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import MarkdownIt from 'markdown-it'
import { schemaNames } from '@olps/domain'

const root = new URL('../', import.meta.url)
const markdown = new MarkdownIt()
const read = file => readFileSync(new URL(file, root), 'utf8')
const tokens = file => markdown.parse(read(file), {})

function taskSections(document) {
  const tasks = new Map()
  let task
  for (const [index, token] of document.entries()) {
    if (token.type === 'heading_open') {
      const heading = document[index + 1].content
      const id = /^W\d+-T\d+\b/.exec(heading)?.[0]
      task = undefined
      if (!id) continue
      assert(!tasks.has(id), `Task 重复 ${id}`)
      task = new Map()
      tasks.set(id, task)
    } else if (task && token.type === 'inline') {
      const field = /^([\p{Script=Han}]+)：(.+)$/u.exec(token.content)
      if (!field) continue
      const [, label, value] = field
      assert(!task.has(label), `Task 字段重复 ${label}`)
      task.set(label, value)
    }
  }
  return tasks
}

test('逐项记录与 Wave 计划的 37 项验收要求一致', () => {
  const plan = taskSections(tokens('docs/plans/2026-11-20-wp-style-cms-wave-plan.md'))
  const recordFile = 'docs/validation/cms-task-acceptance.md'
  assert.equal(plan.size, 37)
  assert(existsSync(new URL(recordFile, root)), '缺少 CMS 逐项验收记录')
  const record = taskSections(tokens(recordFile))
  assert.deepEqual([...record.keys()], [...plan.keys()])

  const statuses = ['已验证', '待核验', '待验收']
  const commits = new Set()
  for (const [id, requirements] of plan) {
    const entry = record.get(id)
    const criterion = requirements.get('量化验收') ?? requirements.get('验证')
    assert(criterion, `${id} 缺少计划验收要求`)
    assert.equal(entry.get('验收要求'), criterion, `${id} 验收要求与计划不一致`)
    const status = entry.get('状态')?.replace(/。$/, '')
    assert(statuses.includes(status), `${id} 状态无效`)
    for (const field of ['验证', '证据']) assert(entry.get(field)?.trim(), `${id} 缺少${field}`)
    const commitField = entry.get('提交') ?? ''
    const references = [...commitField.matchAll(/`([a-f\d]{7,40})`/g)].map(match => match[1])
    assert(references.length > 0, `${id} 缺少可追踪的提交`)
    for (const commit of references) commits.add(commit)
  }
  for (const commit of commits) {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root, stdio: 'pipe' })
  }
})

test('sandbox 设计清单、JSON Schema 文件和 domain 导出一致', () => {
  const design = tokens('docs/design/sandbox-formats.md')
  const heading = design.findIndex(token => token.type === 'inline' && token.content === '16. Schema 文件')
  assert(heading >= 0, '缺少 Schema 文件章节')
  const list = design[heading + 2]
  assert.equal(list.type, 'fence')
  const [directory, ...filenames] = list.content.trim().split('\n').map(line => line.trim())
  assert.equal(directory, 'packages/domain/src/schemas/')
  assert.equal(filenames.length, 19)
  const actual = readdirSync(new URL(directory, root)).filter(file => file.endsWith('.json')).sort()
  assert.deepEqual([...filenames].sort(), actual)
  assert.deepEqual(schemaNames.map(name => `${name}.schema.json`).sort(), actual)

  for (const file of actual) {
    const schema = JSON.parse(read(`${directory}${file}`))
    assert.equal(schema.$id, `https://olps.dev/schemas/v1/${file}`)
  }
})
