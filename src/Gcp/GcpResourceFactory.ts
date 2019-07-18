import * as gcp from "@pulumi/gcp"
import * as GcpResourceConfig from "./GcpResourceConfig.json";
import * as _ from "lodash";
import GcpProcessor from "./GcpProcessor";
import { BuildSpec } from "@project-furnace/stack-processor/src/Model";
import { ResourceConfig } from "../Types";
import Base64Util from "../Util/Base64Util";

export default class GcpResourceFactory {
  static getResource(name: string, type: string, config: any): [any, any] {
    return [ this.getResourceProvider(type), this.getResourceConfig(name, type, config) ];
  }

  private static getResourceProvider(type: string) {

    const providers: { [key: string]: any } = {
      "gcp.storage.Bucket": gcp.storage.Bucket,
      "gcp.storage.BucketObject": gcp.storage.BucketObject,
      "gcp.cloudfunctions.Function": gcp.cloudfunctions.Function,
      "gcp.projects.Service": gcp.projects.Service,
      "gcp.pubsub.Subscription": gcp.pubsub.Subscription,
      "gcp.pubsub.Topic": gcp.pubsub.Topic,
      "gcp.kms.KeyRing": gcp.kms.KeyRing,
      "gcp.kms.CryptoKey": gcp.kms.CryptoKey,
      "gcp.bigquery.Dataset": gcp.bigquery.Dataset,
      "gcp.bigquery.Table": gcp.bigquery.Table,
      "gcp.compute.Instance": gcp.compute.Instance
    }

    const provider = providers[type];
    if (!provider) throw new Error(`unknown resource type ${type}`);
    return provider;
  }

  private static getResourceConfig(name: string, type: string, config: any): any {
    const newConfig = _.cloneDeep(config);

    const nameProp = (GcpResourceConfig.nameProperties as { [key: string]: string })[type] || "name";
    newConfig[nameProp] = name;
    newConfig.name = name;

    return newConfig;
  }

  static getNativeResourceConfig(component: BuildSpec, processor: GcpProcessor): ResourceConfig[] {
    const name = component.meta!.identifier
      , { type, config } = component
      ;

    const REGEX = /(\w+)-([\w_-]+)-(\w+)/;
    const name_bits = REGEX.exec(name);

    if( !name_bits) 
      throw new Error('Unable to destructure name while creating native resource');

    switch(type) {
      case 'Table':
        //BigQuery is not really the perfect match for a document store. Migrating to use Firestore
        /*const datasetId = `${name_bits[1].replace(/-/g, '_')}_${name_bits[2].replace(/-/g, '_')}_dataset_${name_bits[3].replace(/-/g, '_')}`;
        const tableId = `${name_bits[1].replace(/-/g, '_')}_${name_bits[2].replace(/-/g, '_')}_${name_bits[3].replace(/-/g, '_')}`;
        const datasetConfig = {
          datasetId: datasetId,
          location: gcp.config.region
        };
        const tableConfig = {
            datasetId: '${' + name_bits[2] + '_dataset' + '.datasetId}',
            schema: '[{"name": "' + config.primaryKey + '", "type": "' + config.primaryKeyType.toUpperCase() + '", "mode": "NULLABLE"}]',
            tableId: tableId,
            timePartitioning: {
                type: "DAY"
            }
        };
        const dataset = processor.resourceUtil.configure(`${name_bits[1]}-${name_bits[2]}_dataset-${name_bits[3]}`, 'gcp.bigquery.Dataset', datasetConfig, 'resource', {}, {}, componentType);
        const table = processor.resourceUtil.configure(name, 'gcp.bigquery.Table', tableConfig, 'resource', {}, {}, componentType);
        return [dataset, table];*/
        const cloudfunctionsServiceConfig = processor.resourceUtil.configure(`${processor.resourceUtil.global.stack.name}-firestore-${processor.resourceUtil.global.stack.environment}`, 'gcp.projects.Service', {
          project: processor.resourceUtil.global.account.project,
          service: 'firestore.googleapis.com',
        }, 'resource');
        return [cloudfunctionsServiceConfig];


      case 'ActiveConnector':
        // if the output is passed as a var we need to get the resource name so we can still use vars on the yaml config
        const resourceName = (config.output.source.startsWith('${') ? config.output.source.substring(0, config.output.source.length - 6).substring(2) : config.output.source);
        const output = {
          name: 'google-cloud-pub-sub',
          options: {
            topic:  processor.resourceUtil.global.stack.name + '-' + resourceName + '-' + processor.resourceUtil.global.stack.environment
          }
        };

        const acConfig = {
          bootDisk: {
              initializeParams: {
                  image: 'projects/cos-cloud/global/images/cos-stable-74-11895-86-0',
              },
          },
          machineType: 'g1-small',
          metadata: {
              'gce-container-declaration': "spec:\n  containers:\n    - name: connector-test\n      image: 'projectfurnace/active-connectors:latest'\n      env:\n        - name: INPUT\n          value: " + Base64Util.toBase64(JSON.stringify(config.input)) + "\n        - name: OUTPUT\n          value: " + Base64Util.toBase64(JSON.stringify(output)) + "\n      stdin: false\n      tty: false\n  restartPolicy: Always\n\n",
              'google-logging-enabled': "true"
          },
          networkInterfaces: [{
              accessConfigs: [{}],
              network: 'default',
          }],
          serviceAccount: {
              scopes: [
                  'userinfo-email',
                  'compute-ro',
                  'storage-ro',
                  'logging-write',
                  'monitoring-write',
                  'pubsub'
              ],
          },
          //always use the -a zone. not sure how to better get this
          zone: gcp.config.region + '-a',
          name: name
        }
        return [processor.resourceUtil.configure(name, 'gcp.compute.Instance', acConfig, 'resource', {}, {})];

      default:
        return [processor.resourceUtil.configure(name, type!, config, 'resource', {}, {})];
    }
  }
}