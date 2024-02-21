export class ParaSwap {
  private readonly baseUrl = 'https://apiv5.paraswap.io';

  private formatParams(queryParams: Record<string, string>) {
    const searchString = new URLSearchParams(queryParams);
    return searchString;
  }

  async getDatasTx(chainId: string, proxy: string, slippage: string, txs: Array<any>, receiver?: string) {
    const slippageFomatted = Number(slippage) / 100;
    const totalPercentage = 1;

    const txURL = `${this.baseUrl}/transactions/${chainId}?gasPrice=50000000000&ignoreChecks=true&ignoreGasEstimate=false&onlyParams=false`;
    const requests = txs.map(async (tx) => {
      const txConfig = {
        priceRoute: tx,
        srcToken: tx.srcToken,
        srcDecimals: tx.srcDecimals,
        destToken: tx.destToken,
        destDecimals: tx.destDecimals,
        srcAmount: tx.srcAmount,
        destAmount: (tx.destAmount * (totalPercentage - slippageFomatted)).toFixed(0),
        userAddress: proxy,
        partner: tx.partner,
        receiver: receiver ?? proxy,
      };
      const resJson = await fetch(txURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(txConfig),
      });
      const response = await resJson.json();

      if (response?.error) {
        throw { code: 'KASS#01', message: response.error };
      }
      return response.data;
    });
    const datas = await Promise.all(requests);

    return datas;
  }

  async getAmountsOut(params: GetAmountsParams) {
    const { srcToken, srcDecimals, amount, destToken, destDecimals, chainId } = params;
    const query = this.formatParams({
      srcToken,
      srcDecimals,
      destToken,
      destDecimals: destDecimals || '18',
      amount: amount,
      side: 'SELL',
      network: chainId,
    });
    const resJson = await fetch(`${this.baseUrl}/prices?${query}`);
    const data = await resJson.json();

    if (data?.priceRoute) {
      return {
        amountsTokenIn: data.priceRoute.destAmount,
        transactionsDataTx: data.priceRoute,
      };
    }

    return {
      amountsTokenIn: 0,
      transactionsDataTx: {},
    };
  }
}

export type GetAmountsParams = {
  srcToken: string;
  srcDecimals: string;
  destToken: string;
  destDecimals: string;
  amount: string;
  chainId: string;
};

export type GetAmountsResult = {
  amountsTokenIn: string[];
  transactionsDataTx: string[];
};
