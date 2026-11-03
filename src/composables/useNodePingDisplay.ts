import type { MaybeRefOrGetter } from 'vue'
import type { NodePingTaskLatency } from '@/composables/useNodePingStats'
import type { PingTaskInfo } from '@/utils/rpc'
import { computed, ref, shallowRef, toValue, watch } from 'vue'
import { useNodePingStats } from '@/composables/useNodePingStats'
import { PING_SUMMARY_MAX_COUNT } from '@/constants/load'
import { loadPublicPingTasks } from '@/services/metrics.service'
import { useAppStore } from '@/stores/app'
import { formatDateTime } from '@/utils/helper'

export type NodePingMetric = 'latency' | 'loss'

export interface NodePingBar {
  key: string
  className: string
  tooltip: string
}

interface UseNodePingDisplayOptions {
  enabled?: MaybeRefOrGetter<boolean>
  loadingDisplayText?: string
  emptyDisplayText?: string
  loadingPanelTooltipText?: Partial<Record<NodePingMetric, string>>
  emptyPanelTooltipText?: Partial<Record<NodePingMetric, string>>
}

const EMPTY_PING_BAR_COUNT = 20
const TASK_PING_BAR_COUNT = 20
const pingTaskCatalog = shallowRef<PingTaskInfo[]>([])
let pingTaskCatalogLoadedAt = 0
let pingTaskCatalogPromise: Promise<void> | null = null

function ensurePingTaskCatalog(): Promise<void> {
  if (Date.now() - pingTaskCatalogLoadedAt < 300_000)
    return Promise.resolve()
  if (pingTaskCatalogPromise)
    return pingTaskCatalogPromise

  pingTaskCatalogPromise = loadPublicPingTasks()
    .then((tasks) => {
      pingTaskCatalog.value = [...tasks].sort((left, right) =>
        (left.weight ?? left.id) - (right.weight ?? right.id) || left.id - right.id,
      )
      pingTaskCatalogLoadedAt = Date.now()
    })
    .catch(() => {})
    .finally(() => {
      pingTaskCatalogPromise = null
    })
  return pingTaskCatalogPromise
}

function getLatencyToneClass(latency: number): string {
  if (latency <= 60)
    return 'bg-signal-1'
  if (latency <= 100)
    return 'bg-signal-2'
  if (latency <= 160)
    return 'bg-signal-3 ping-signal-pattern-2'
  if (latency <= 200)
    return 'bg-signal-4 ping-signal-pattern-3'
  return 'bg-signal-5 ping-signal-pattern-4'
}

function getLossToneClass(loss: number): string {
  if (loss <= 1)
    return 'bg-signal-1'
  if (loss <= 3)
    return 'bg-signal-2'
  if (loss <= 6)
    return 'bg-signal-3 ping-signal-pattern-2'
  if (loss <= 9)
    return 'bg-signal-4 ping-signal-pattern-3'
  return 'bg-signal-5 ping-signal-pattern-4'
}

function buildTaskBars(history: NodePingTaskLatency['history'], metric: NodePingMetric): NodePingBar[] {
  return Array.from({ length: TASK_PING_BAR_COUNT }, (_, index) => {
    const offset = Math.max(0, TASK_PING_BAR_COUNT - history.length)
    const bucketIndex = index - offset
    const start = bucketIndex < 0 ? 0 : Math.floor(bucketIndex * history.length / Math.min(history.length, TASK_PING_BAR_COUNT))
    const end = bucketIndex < 0 ? 0 : Math.floor((bucketIndex + 1) * history.length / Math.min(history.length, TASK_PING_BAR_COUNT))
    const points = history.slice(start, end)
    const latest = points.at(-1)
    const valid = points.flatMap(point => point[metric] === null ? [] : [point[metric]!])
    const value = valid.length ? valid.reduce((sum, current) => sum + current, 0) / valid.length : null

    return {
      key: `task-${metric}-${index}`,
      className: !points.length ? 'bg-muted-foreground/10' : value === null ? 'bg-muted-foreground/15' : metric === 'latency' ? getLatencyToneClass(value) : getLossToneClass(value),
      tooltip: !latest ? '无采样数据' : `${formatDateTime(latest.time, 'HH:mm:ss')}\n${value === null ? '无采样数据' : metric === 'latency' ? `${Math.round(value)} ms` : `丢包 ${value.toFixed(1)}%`}`,
    }
  })
}

export function useNodePingDisplay(
  uuid: MaybeRefOrGetter<string>,
  options: UseNodePingDisplayOptions = {},
) {
  const appStore = useAppStore()

  const pingStatsEnabled = computed(() => {
    if (toValue(options.enabled) === false)
      return false
    if (appStore.publicSettings?.record_enabled === false)
      return false
    return appStore.publicSettings?.ping_record_preserve_time !== 0
  })

  const pingStatsHours = computed(() => {
    const preserveTime = appStore.publicSettings?.ping_record_preserve_time
    if (typeof preserveTime === 'number' && preserveTime > 0)
      return Math.min(preserveTime, 1)
    return 1
  })

  const pingStats = useNodePingStats(uuid, {
    hours: pingStatsHours,
    enabled: pingStatsEnabled,
    maxCount: PING_SUMMARY_MAX_COUNT,
  })

  watch(pingStatsEnabled, (enabled) => {
    if (enabled)
      void ensurePingTaskCatalog()
  }, { immediate: true })

  const taskLatencyItems = computed(() => {
    if (!pingStatsEnabled.value)
      return []

    const nodeUuid = toValue(uuid)
    const measured = new Map(pingStats.taskLatencies.value.map(task => [task.taskId, task]))
    const configured = pingTaskCatalog.value.filter(task =>
      task.default_on === true || task.clients?.includes(nodeUuid) || measured.has(task.id),
    )
    const ordered = [
      ...configured.map(task => ({ ...measured.get(task.id), taskId: task.id, name: task.name?.trim() || measured.get(task.id)?.name || `Task ${task.id}` })),
      ...pingStats.taskLatencies.value.filter(task => !configured.some(configuredTask => configuredTask.id === task.taskId)),
    ]

    return ordered.map(task => ({
      taskId: task.taskId,
      name: task.name,
      status: task.status ?? 'no-data',
      display: task.status === 'loss' ? '丢包' : task.latency === null || task.latency === undefined ? '无数据' : `${Math.round(task.latency)} ms`,
      lossDisplay: task.loss === null || task.loss === undefined ? '—' : `${task.loss.toFixed(1)}%`,
      latencyBars: buildTaskBars(task.history ?? [], 'latency'),
      lossBars: buildTaskBars(task.history ?? [], 'loss'),
    }))
  })

  const taskLatencyTooltip = computed(() => taskLatencyItems.value.map(task => `${task.name}：${task.display}，丢包 ${task.lossDisplay}`).join('\n'))

  function buildPingBars(metric: NodePingMetric): NodePingBar[] {
    const points = pingStats.history.value
    if (!points.length)
      return []

    return points.map((point, index) => {
      const value = point[metric]

      return {
        key: `${point.time}-${index}`,
        className: value === null
          ? 'bg-muted-foreground/15'
          : metric === 'latency'
            ? getLatencyToneClass(value)
            : getLossToneClass(value),
        tooltip: value === null
          ? `${formatDateTime(point.time, 'HH:mm:ss')}\n无采样数据`
          : metric === 'latency'
            ? `${formatDateTime(point.time, 'HH:mm:ss')}\n${Math.round(value)} ms`
            : `${formatDateTime(point.time, 'HH:mm:ss')}\n${value.toFixed(1)}%`,
      }
    })
  }

  function buildEmptyPingBars(metric: NodePingMetric): NodePingBar[] {
    const tooltip = pingStats.loading.value
      ? '加载中'
      : pingStats.error.value
        ? '加载失败'
        : !pingStatsEnabled.value
            ? '未启用记录'
            : metric === 'latency'
              ? '无采样数据'
              : '无采样数据'

    return Array.from({ length: EMPTY_PING_BAR_COUNT }, (_, index) => ({
      key: `${metric}-empty-${index}`,
      className: 'bg-muted-foreground/10',
      tooltip,
    }))
  }

  const latencyBars = computed(() => buildPingBars('latency'))
  const lossBars = computed(() => buildPingBars('loss'))
  // 路由跳转/选中切换瞬间 enabled 变 false，会导致节点卡片 ping 数据被清空闪烁。
  // 记忆最后一次有数据的显示，避免降级为占位符（-）。
  const lastLatencyBars = ref<NodePingBar[]>([])
  const lastLossBars = ref<NodePingBar[]>([])
  const lastLatencyText = ref('')
  const lastLossText = ref('')

  const latencyRenderBars = computed(() => {
    if (latencyBars.value.length) {
      lastLatencyBars.value = latencyBars.value
      return latencyBars.value
    }
    if (lastLatencyBars.value.length)
      return lastLatencyBars.value
    return buildEmptyPingBars('latency')
  })
  const lossRenderBars = computed(() => {
    if (lossBars.value.length) {
      lastLossBars.value = lossBars.value
      return lossBars.value
    }
    if (lastLossBars.value.length)
      return lastLossBars.value
    return buildEmptyPingBars('loss')
  })

  const latencyDisplay = computed(() => {
    if (pingStats.hasData.value) {
      const text = `${Math.round(pingStats.avgLatency.value)} ms`
      lastLatencyText.value = text
      return text
    }
    if (lastLatencyText.value)
      return lastLatencyText.value
    if (pingStats.loading.value)
      return options.loadingDisplayText ?? '加载中'
    return options.emptyDisplayText ?? '-'
  })

  const lossDisplay = computed(() => {
    if (pingStats.hasData.value) {
      const text = `${pingStats.avgLoss.value.toFixed(1)}%`
      lastLossText.value = text
      return text
    }
    if (lastLossText.value)
      return lastLossText.value
    if (pingStats.loading.value)
      return options.loadingDisplayText ?? '加载中'
    return options.emptyDisplayText ?? '-'
  })

  const latencyPanelTooltip = computed(() => {
    if (!pingStats.hasData.value) {
      if (pingStats.loading.value)
        return options.loadingPanelTooltipText?.latency ?? ''
      return options.emptyPanelTooltipText?.latency ?? ''
    }
    return `平均延迟 ${Math.round(pingStats.avgLatency.value)} ms`
  })

  const lossPanelTooltip = computed(() => {
    if (!pingStats.hasData.value) {
      if (pingStats.loading.value)
        return options.loadingPanelTooltipText?.loss ?? ''
      return options.emptyPanelTooltipText?.loss ?? ''
    }

    const volatility = pingStats.avgVolatility.value > 0
      ? `，平均波动 ${pingStats.avgVolatility.value.toFixed(2)}`
      : ''
    return `平均丢包 ${pingStats.avgLoss.value.toFixed(1)}%${volatility}`
  })

  return {
    pingStats,
    pingStatsEnabled,
    pingStatsHours,
    latencyRenderBars,
    lossRenderBars,
    latencyDisplay,
    lossDisplay,
    latencyPanelTooltip,
    lossPanelTooltip,
    taskLatencyItems,
    taskLatencyTooltip,
  }
}
