import * as pulumi from '@pulumi/pulumi'
import * as sinon from 'sinon'

export function stubCustomResource() {
  /**
   * Creates and registers a new resource object.  [t] is the fully qualified type token and
   * [name] is the "name" part to use in creating a stable and globally unique URN for the object.
   * dependsOn is an optional list of other resources that this resource depends on, controlling
   * the order in which we perform resource operations.
   *
   * @param t The type of the resource.
   * @param name The _unique_ name of the resource.
   * @param custom True to indicate that this is a custom resource, managed by a plugin.
   * @param props The arguments to use to populate the new resource.
   * @param opts A bag of options that control this resource's behavior.
   */
  const customResourceStub = sinon.stub().callsFake(function (t, name, custom, props = {}, opts = {}) {
    for (let prop in props) {
      this[prop] = props[prop]
    }

    // Custom properties can be set in here
    // 
    // Properties are different as per resource for example an S3 bucket will have the 
    // property of this.bucket
    this.id = Math.floor(Math.random() * 100);
    this.bucket = name;
    this.storageConnectionString = 'test';
    
    return this;
  })
  Object.setPrototypeOf(pulumi.CustomResource, customResourceStub);
}