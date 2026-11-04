import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installKomariFixture } from './fixtures/komari'

const STABLE_STYLE = `
  *, *::before, *::after {
    animation: none !important;
    caret-color: transparent !important;
    transition: none !important;
  }
  html { scroll-behavior: auto !important; }
`

async function openStablePage(page: Page, path = '/'): Promise<void> {
  await page.goto(path)
  await expect(page.getByRole('heading', { name: 'Komari Visual Lab' })).toBeVisible()
  await page.addStyleTag({ content: STABLE_STYLE })
  await page.waitForTimeout(700)
  await expect(page.locator('html')).toHaveJSProperty('scrollWidth', await page.locator('html').evaluate(element => element.clientWidth))
}

async function expectNodeMetricIcons(page: Page): Promise<void> {
  for (const metric of ['cpu', 'memory', 'disk', 'traffic'])
    await expect(page.locator(`[data-node-metric-icon="${metric}"]`).first()).toBeVisible()
}

const BLUEPRINT_TOOL = '蓝图：工程蓝图总图 · 分区 · 设备表'
const SHOW_TOOLS = '显示首页工具'

/** 工具条默认折叠，先展开再进入蓝图工具 */
async function openBlueprint(page: Page): Promise<void> {
  await page.getByRole('button', { name: SHOW_TOOLS }).click()
  await page.getByRole('button', { name: BLUEPRINT_TOOL }).click()
}

// ===== blueprint 视图（通过「蓝图」工具切换，默认视图为节点卡片） =====

test('blueprint home light desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installKomariFixture(page)
  await openStablePage(page)

  await openBlueprint(page)
  await expect(page.getByText('基础设施蓝图')).toBeVisible()
  await expect(page.getByText('拓扑总图')).toBeVisible()
  await expect(page.getByText('总线 · komari-core')).toBeVisible()
  await expect(page.getByRole('heading', { name: '设备表' })).toBeVisible()
  await expect(page).toHaveScreenshot('blueprint-home.png', { fullPage: false })
})

test('blueprint home dark mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installKomariFixture(page, { dark: true })
  await openStablePage(page)

  await openBlueprint(page)
  await expect(page.getByText('基础设施蓝图')).toBeVisible()
  await expect(page).toHaveScreenshot('blueprint-home-dark-mobile.png', { fullPage: false })
})

test('blueprint schedule renders grouped rows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installKomariFixture(page)
  await openStablePage(page)

  await openBlueprint(page)
  await expect(page.getByText('基础设施蓝图')).toBeVisible()
  await expect(page.locator('table.bp-sched')).toBeVisible()
  await expect(page.locator('table.bp-sched tbody tr').first()).toBeVisible()
})

// ===== 节点卡片 / 列表视图（默认视图，无需切换） =====

for (const [palette, lightInk, darkInk] of [
  ['emerald', '#125239', '#eafff3'],
  ['violet', '#4d3173', '#f7efff'],
  ['amber', '#683d0c', '#fff3df'],
] as const) {
  for (const dark of [false, true]) {
    test(`${palette} palette follows ${dark ? 'dark' : 'light'} mode`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await installKomariFixture(page, { dark, themePalette: palette })
      await openStablePage(page)

      const colors = await page.locator('html').evaluate((element, currentPalette) => {
        const style = getComputedStyle(element)
        return {
          paletteClass: element.classList.contains(`palette-${currentPalette}`),
          darkClass: element.classList.contains('dark'),
          foreground: style.getPropertyValue('--foreground').trim(),
          card: style.getPropertyValue('--card').trim(),
          muted: style.getPropertyValue('--muted-foreground').trim(),
          globe: style.getPropertyValue('--globe-point').trim(),
          grid: style.getPropertyValue('--grid-ink').trim(),
        }
      }, palette)
      expect(colors.paletteClass).toBe(true)
      expect(colors.darkClass).toBe(dark)
      expect(colors.foreground).toBe(dark ? darkInk : lightInk)
      expect(colors.globe).toBe(dark ? darkInk : lightInk)
      expect(colors.grid).not.toBe('29 78 137')
      const contrastRatio = (left: string, right: string) => {
        const luminance = (hex: string) => {
          const expanded = hex.length === 4 ? `#${Array.from(hex.slice(1), digit => digit + digit).join('')}` : hex
          const channels = expanded.slice(1).match(/.{2}/g)!.map(part => Number.parseInt(part, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
          return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
        }
        const a = luminance(left)
        const b = luminance(right)
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      }
      expect(contrastRatio(colors.foreground, colors.card)).toBeGreaterThanOrEqual(7)
      expect(contrastRatio(colors.muted, colors.card)).toBeGreaterThanOrEqual(7)
    })
  }
}

test('nodes tool view renders card grid', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installKomariFixture(page)
  await openStablePage(page)

  await expectNodeMetricIcons(page)
  const card = page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情' })
  await expect(card).toBeVisible()
  await expect(page).toHaveScreenshot('nodes-card-desktop.png', { fullPage: false })
})

test('mobile overview cards keep values and units together in two columns', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installKomariFixture(page)
  await openStablePage(page)

  const cards = page.locator('[data-general-card-key]')
  await expect(cards).toHaveCount(6)
  const first = await cards.nth(0).boundingBox()
  const second = await cards.nth(1).boundingBox()
  const third = await cards.nth(2).boundingBox()
  expect(first && second && third).toBeTruthy()
  expect(Math.abs(first!.y - second!.y)).toBeLessThan(2)
  expect(third!.y).toBeGreaterThan(first!.y + first!.height - 2)

  for (const card of await cards.all()) {
    const value = card.locator('[data-general-card-mobile-value]')
    await expect(value).toBeVisible()
    expect(await value.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  }

  await expect(page.locator('[data-general-card-key="memory"] [data-general-card-mobile-value]')).toContainText('GB')
  await expect(page.locator('[data-general-card-key="disk"] [data-general-card-mobile-detail]')).toContainText('总量')
  await expect(page.locator('[data-general-card-key="netSpeed"] [data-general-card-mobile-value]')).toContainText('↑')
  await expect(page.locator('[data-general-card-key="netSpeed"] [data-general-card-mobile-detail]')).toContainText('↓')
  await expect(page.locator('[data-general-card-key="onlineNodes"] [data-general-card-mobile-detail]')).toContainText('离线')

  for (const detail of await page.locator('[data-general-card-mobile-detail]').all()) {
    expect(await detail.evaluate((element) => {
      const style = getComputedStyle(element)
      return Number.parseFloat(style.fontSize) >= 14 && element.scrollWidth <= element.clientWidth + 1
    })).toBe(true)
  }
  const mobileTypography = async (cardKey: string, selector: string) => page.locator(`[data-general-card-key="${cardKey}"] ${selector}`).evaluate((element) => {
    const style = getComputedStyle(element)
    return { fontSize: style.fontSize, fontWeight: style.fontWeight, color: style.color }
  })
  for (const key of ['netSpeed', 'memory', 'disk'])
    expect(await mobileTypography(key, '[data-general-card-mobile-detail]')).toEqual(await mobileTypography(key, '[data-general-card-mobile-value]'))
  expect(await mobileTypography('disk', '[data-general-card-mobile-value]')).toEqual(await mobileTypography('memory', '[data-general-card-mobile-value]'))

  await page.setViewportSize({ width: 320, height: 700 })
  for (const card of await cards.all()) {
    const value = card.locator('[data-general-card-mobile-value]')
    expect(await value.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    const detail = card.locator('[data-general-card-mobile-detail]')
    if (await detail.count())
      expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  }

  await page.setViewportSize({ width: 854, height: 700 })
  for (const key of ['netSpeed', 'memory', 'disk']) {
    expect(await mobileTypography(key, '[data-general-card-mobile-detail]')).toEqual(await mobileTypography(key, '[data-general-card-mobile-value]'))
    for (const line of await page.locator(`[data-general-card-key="${key}"] [data-general-card-mobile-value], [data-general-card-key="${key}"] [data-general-card-mobile-detail]`).all()) {
      await expect(line).toBeVisible()
      expect(await line.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    }
  }

  const pingTask = page.locator('[data-node-ping-task-id]').first()
  await expect(pingTask).toContainText('最近延迟')
  await expect(pingTask).toContainText('1小时丢包')
})

test('foreign-currency remaining value uses the latest online rate in CNY', async ({ page }) => {
  await page.route('https://open.er-api.com/v6/latest/CNY', route => route.fulfill({
    json: {
      result: 'success',
      rates: { CNY: 1, USD: 0.14, HKD: 1.1, EUR: 0.12, GBP: 0.1, JPY: 22, RUB: 13, CHF: 0.12, INR: 11, VND: 3500, THB: 5, CAD: 0.19 },
    },
    headers: { 'access-control-allow-origin': '*' },
  }))
  await installKomariFixture(page)
  await openStablePage(page)

  const card = page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情' })
  const convertedValue = card.locator('span[title*="原币"]')
  await expect(convertedValue).toHaveText(/^≈¥/)
  await expect(convertedValue).toHaveAttribute('title', /原币 USD \$/)
  await expect(convertedValue).toHaveAttribute('title', /每日更新的在线汇率/)
})

test('free and unset-price nodes show distinct remaining-value labels', async ({ page }) => {
  await installKomariFixture(page, { freePriceNode: true })
  await openStablePage(page)

  await expect(page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情' }).getByText('免费', { exact: true }).last()).toBeVisible()
  await expect(page.getByRole('button', { name: '查看节点 伦敦-离线归档 详情' }).getByText('无', { exact: true })).toBeVisible()
})

test('nodes tool view mini card icons remain accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installKomariFixture(page, { nodeCardSize: 'mini' })
  await openStablePage(page)

  const card = page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情' })
  await expect(card.locator('[data-node-metric-icon="cpu"]')).toBeVisible()
  await expect(card.locator('[data-node-metric-icon="memory"]')).toBeVisible()
  await expect(card.locator('[data-node-metric-icon="traffic"]')).toBeVisible()
  await expect(card.getByRole('img', { name: 'CPU' })).toBeVisible()
  await expect(card.getByRole('img', { name: '内存' })).toBeVisible()
})

// ===== 节点详情页 =====

test('detail light desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installKomariFixture(page)
  await openStablePage(page, '/instance/00000000-0000-4000-8000-000000000001')
  await expect(page.getByText('硬件信息')).toBeVisible()
  await expect(page).toHaveScreenshot('detail-light-desktop.png', { fullPage: false })
})

test('detail dark mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installKomariFixture(page, { dark: true })
  await openStablePage(page, '/instance/00000000-0000-4000-8000-000000000002')
  await expect(page.getByText('硬件信息')).toBeVisible()
  await expect(page).toHaveScreenshot('detail-dark-mobile.png', { fullPage: false })
})

test('detail short history falls back when metric history omits CPU', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installKomariFixture(page, { missingCpuMetricHistory: true })
  await openStablePage(page, '/instance/00000000-0000-4000-8000-000000000001')

  const cpuValue = page.locator('[data-load-chart-card="cpu"] [data-latest-cpu]')
  const loadRange = page.locator('[data-load-chart-range]')
  for (const view of ['4 小时', '1 天']) {
    await loadRange.getByRole('tab', { name: view, exact: true }).click()
    await expect(cpuValue).toHaveText(/^\d+\.\d$/)
  }
})

test('detail history keeps cumulative traffic counters on their last value', async ({ page }) => {
  const historyCalls: Array<Record<string, unknown>> = []

  page.on('request', (request) => {
    if (!request.url().endsWith('/api/rpc2'))
      return

    const payload = request.postDataJSON() as { method?: string, params?: Record<string, unknown> } | null
    const metricKeys = Array.isArray(payload?.params?.metric_keys) ? payload.params.metric_keys : []
    if (payload?.method === 'public:queryMetrics' && metricKeys.includes('net.total.up'))
      historyCalls.push(payload.params ?? {})
  })

  await page.setViewportSize({ width: 1280, height: 720 })
  await installKomariFixture(page)
  await openStablePage(page, '/instance/00000000-0000-4000-8000-000000000001')

  await page.locator('[data-load-chart-range]').getByRole('tab', { name: '1 天', exact: true }).click()
  await expect.poll(() => historyCalls.length).toBeGreaterThan(0)

  expect(historyCalls.at(-1)).toMatchObject({
    aggregation: 'avg',
    aggregation_by_metric: {
      'net.total.up': 'last',
      'net.total.down': 'last',
    },
  })
})

test('detail ping requests stay scoped to the current node', async ({ page }) => {
  const currentUuid = '00000000-0000-4000-8000-000000000001'
  const metricCalls: Array<{ method: string, params: Record<string, unknown> }> = []
  const isPingMetricCall = (call: { method: string, params: Record<string, unknown> }): boolean => {
    const metricKeys = Array.isArray(call.params.metric_keys) ? call.params.metric_keys : []
    return call.method === 'public:getPingMetricStats'
      || metricKeys.includes('ping.latency_ms')
      || metricKeys.includes('ping.loss')
  }

  page.on('request', (request) => {
    if (!request.url().endsWith('/api/rpc2'))
      return

    const payload = request.postDataJSON() as { method?: string, params?: Record<string, unknown> } | null
    if (payload?.method === 'public:queryMetrics' || payload?.method === 'public:getPingMetricStats') {
      metricCalls.push({ method: payload.method, params: payload.params ?? {} })
    }
  })

  await page.setViewportSize({ width: 1280, height: 720 })
  await installKomariFixture(page)
  await openStablePage(page)

  // 默认即节点卡片视图，首页 Ping 摘要订阅自动开始。
  // RequestManager 并发限制会让 12 个节点的 Ping 摘要请求排队陆续发出，
  // 等全部发出后再清空，避免队列残留被误计入详情页。
  await expect.poll(() => metricCalls.filter(isPingMetricCall).length).toBeGreaterThan(0)
  await expect.poll(() => metricCalls.filter(call => call.method === 'public:queryMetrics' && isPingMetricCall(call)).length).toBe(12)
  const homeSummaryCalls = metricCalls.filter(call => call.method === 'public:queryMetrics' && isPingMetricCall(call))
  expect(homeSummaryCalls.length).toBeGreaterThan(0)
  expect(homeSummaryCalls.every(call => call.params.max_points === 150)).toBe(true)

  metricCalls.length = 0
  await page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情' }).click()
  await expect(page).toHaveURL(`/instance/${currentUuid}`)
  await expect(page.getByText('硬件信息')).toBeVisible()
  await page.waitForTimeout(2_000)

  const detailPingCalls = metricCalls.filter(isPingMetricCall)
  expect(detailPingCalls.length).toBeGreaterThan(0)
  expect(new Set(detailPingCalls.map(call => call.params.entity_id))).toEqual(new Set([currentUuid]))
})

test('detail ping tasks follow the backend task order', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installKomariFixture(page, { pingTaskOrdering: true })
  await openStablePage(page, '/instance/00000000-0000-4000-8000-000000000001')

  const taskCards = page.locator('[data-ping-task-id]')
  await expect(taskCards).toHaveCount(3)
  await expect(taskCards.first()).toHaveAttribute('data-ping-task-id', '30')
  await expect(taskCards.nth(1)).toHaveAttribute('data-ping-task-id', '10')
  await expect(taskCards.nth(2)).toHaveAttribute('data-ping-task-id', '20')
  await expect(taskCards).toContainText(['浙江移动', '浙江联通', '浙江电信'])
})

test('home node cards show each ping task latency in backend order', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installKomariFixture(page, { pingTaskOrdering: true })
  await openStablePage(page)

  const taskValues = page.locator('[data-node-ping-task-id]')
  await expect(taskValues.first()).toBeVisible()
  await expect(taskValues.nth(0)).toHaveAttribute('data-node-ping-task-id', '30')
  await expect(taskValues.nth(1)).toHaveAttribute('data-node-ping-task-id', '10')
  await expect(taskValues.nth(2)).toHaveAttribute('data-node-ping-task-id', '20')
  await expect(taskValues.nth(0)).toContainText('浙江移动')
  await expect(taskValues.nth(0)).toContainText('120 ms')
  await expect(taskValues.nth(1)).toContainText('浙江联通')
  await expect(taskValues.nth(1)).toContainText('100 ms')
  await expect(taskValues.nth(2)).toContainText('浙江电信')
  await expect(taskValues.nth(2)).toContainText('110 ms')
  await expect(taskValues.nth(0)).toContainText('2.1%')
  await expect(taskValues.nth(0).locator('[data-node-ping-metric="latency"] span')).toHaveCount(20)
  await expect(taskValues.nth(0).locator('[data-node-ping-metric="loss"] span')).toHaveCount(20)
  await expect(taskValues.nth(0).locator('[data-node-ping-metric="latency"] .bg-signal-5')).toHaveCount(0)
  await expect(taskValues.nth(0).locator('[data-node-ping-metric="loss"] .bg-signal-5')).toHaveCount(1)
  await expect(taskValues.nth(1).locator('[data-node-ping-metric="loss"] .bg-signal-5')).toHaveCount(0)
  await expect(page.locator('[data-node-ping-bars="latency"]')).toHaveCount(0)
  const latencyBox = await taskValues.nth(0).locator('[data-node-ping-metric="latency"]').boundingBox()
  const lossBox = await taskValues.nth(0).locator('[data-node-ping-metric="loss"]').boundingBox()
  expect(latencyBox).not.toBeNull()
  expect(lossBox).not.toBeNull()
  if (latencyBox && lossBox)
    expect(Math.abs(latencyBox.y - lossBox.y)).toBeLessThan(2)
})
