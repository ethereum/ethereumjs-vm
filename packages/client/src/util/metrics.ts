import type * as promClient from 'prom-client'

export const loadPromClient = async () => {
  try {
    const promClient = await import('prom-client')
    return promClient
  } catch (error) {
    throw new Error('Missing prom-client import')
  }
}

export const setupMetrics = async () => {
  const promClient = await loadPromClient()
  return {
    legacyTxGauge: new promClient.Gauge({
      name: 'legacy_transactions_in_transaction_pool',
      help: 'Number of legacy transactions in the client transaction pool',
    }),
    accessListEIP2930TxGauge: new promClient.Gauge({
      name: 'access_list_eip2930_transactions_in_transaction_pool',
      help: 'Number of access list EIP 2930 transactions in the client transaction pool',
    }),
    feeMarketEIP1559TxGauge: new promClient.Gauge({
      name: 'fee_market_eip1559_transactions_in_transaction_pool',
      help: 'Number of fee market EIP 1559 transactions in the client transaction pool',
    }),
    blobEIP4844TxGauge: new promClient.Gauge({
      name: 'blob_eip_4844_transactions_in_transaction_pool',
      help: 'Number of blob EIP 4844 transactions in the client transaction pool',
    }),
  }
}

export type PrometheusMetrics = {
  legacyTxGauge: promClient.Gauge<string>
  accessListEIP2930TxGauge: promClient.Gauge<string>
  feeMarketEIP1559TxGauge: promClient.Gauge<string>
  blobEIP4844TxGauge: promClient.Gauge<string>
}
