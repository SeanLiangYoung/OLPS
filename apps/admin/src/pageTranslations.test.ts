import { expect, it } from 'vitest'
import { missingPageLocales } from './pageTranslations'
import type { PageRecord } from './types'

it('根据翻译组和语言列出缺少的翻译', () => {
  const page = { pageId: 'en', locale: 'en', translationGroupId: 'group' } as PageRecord
  const french = { pageId: 'fr', locale: 'fr', translationGroupId: 'group' } as PageRecord
  expect(missingPageLocales(page, [page, french], ['en', 'fr', 'ja'])).toEqual(['ja'])
  expect(missingPageLocales({ ...page, translationGroupId: undefined }, [page, french], ['en', 'fr'])).toEqual(['fr'])
})
