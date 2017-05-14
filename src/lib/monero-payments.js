// TODO What should be default?
import { EventEmitter } from 'events'

import MoneroWallet from 'monero-nodejs'

// The naming is to remind people that this library is intended to be used
// to RECEIVE PAYMENTS ONLY. The `monero-wallet-rpc` we are connecting to
// MUST be a wallet generated by `monero-wallet-cli --generate-from-view-key`
export class WatchOnlyWallet {
  constructor (host = 'localhost', port = 18082, secure) {
    this.wallet = new MoneroWallet(host, port, secure);

    // Proxy selected MoneroWallet methods
    ['makeIntegratedAddress', 'getTransfers'].forEach((fn, index) => {
      // http://stackoverflow.com/a/1026087/500999
      this[`proxy${fn.charAt(0).toUpperCase() + fn.slice(1)}`] = function () {
        console.log(`[Proxy WatchOnlyWallet] Request ${fn}`, arguments)
        const response = this.wallet[fn].apply(this.wallet, arguments)
        response.then((result) => console.log('[Proxy WatchOnlyWallet] Response', result))
        return response
      }
    })
  }

  requestPayment () {
    return new Payment(this)
  }
}

export class Payment extends EventEmitter {
  constructor (wallet) {
    super()
    console.log('[PaymentRequest] Constructor for wallet', wallet)
    console.warn('Will accept unconfirmed payments for now!')
    this._wallet = wallet
    this._pool = []

    this.amount = 0

    wallet.proxyMakeIntegratedAddress()
      .then((result) => {
        console.log('[PaymentRequest] then', result)
        this._integratedAddress = result.integrated_address
        this._paymentId = result.payment_id
        this.emit('ready', result.integrated_address, result.payment_id)

        this._startPolling()
      })
      .catch((error) => this.emit('error', error))
  }

  get paymentId () {
    return this._paymentId
  }

  get integratedAddress () {
    return this._integratedAddress
  }

  get uri () {
    const integratedAddress = this.integratedAddress
    return integratedAddress ? `monero:${integratedAddress}` : null
  }

  get wallet () {
    return this._wallet
  }

  request () {
    this._startPolling()
  }

  _startPolling () {
    const poll = () => {
      this.wallet.proxyGetTransfers({pool: true}).then((result) => {
        const pool = this._pool = result.pool || []
        const transactionIds = []
        const amount = pool.reduce((amount, transaction) => {
          if (transaction.payment_id === this.paymentId) {
            amount += transaction.amount / 1e12
            transactionIds.push(transaction.txid)
          }
          return amount
        }, 0)

        if (amount >= this.amount) {
          this.emit('payment', {
            amount,
            transactionIds,
            confirmed: false
          })
          window.clearInterval(handle)
        }
        if (amount > 0) {
          console.log('[PaymentRequest] transfers', amount, result.pool)
        }
      })
    }
    const handle = window.setInterval(poll, 10000)
  }
}

// {
//   "amount": 1000000000000,
//   "fee": 0,
//   "height": 0,
//   "note": "",
//   "payment_id": "313bcabdc59c1bfe",
//   "timestamp": 1487615018,
//   "txid": "02a6d1b13ff45f0b29a7efd124e0748874b75b8e61318968890550b2445faf93"
// }
