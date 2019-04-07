import * as azure from '@pulumi/azure'
import * as sinon from 'sinon'

export function stubPlan() {
  sinon.stub(azure.appservice, 'Plan').callsFake(function (name, argsOrState, opts) {
    this.name = name

    return this
  })
}
