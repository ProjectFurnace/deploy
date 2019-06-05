import * as aws from '@pulumi/aws'
import * as sinon from 'sinon'

export function stubKinesisStream() {
  sinon.stub(aws.kinesis, 'Stream').callsFake(function (name, argsOrState, opts) {
    this.name = name

    return this
  })
}
