import { expect, it } from 'vitest'
import { validatedAttribute } from './attributes'

it('高级属性允许语义属性并拒绝执行代码与系统标识', () => {
  expect(validatedAttribute('title', '产品说明')).toEqual({ title: '产品说明' })
  expect(validatedAttribute('aria-hidden', 'true')).toEqual({ 'aria-hidden': 'true' })
  for (const name of ['onclick', 'srcdoc', 'id', 'data-olps-inquiry', 'href', 'style']) {
    expect(() => validatedAttribute(name, 'value')).toThrow()
  }
  expect(() => validatedAttribute('tabindex', 'abc')).toThrow()
})
