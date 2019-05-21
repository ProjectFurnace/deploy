const kms = require('@google-cloud/kms');
const {Storage} = require('@google-cloud/storage');

// Read file
function readFile(file) {
  return new Promise((resolve, reject) => {
    const fileReader = file.createReadStream();
    const buffers = [];
    fileReader.on('data', function(data) {
      buffers.push(data);
    }).on('end', function() {
      resolve(Buffer.concat(buffers));
    }).on('error', (error) => {
      reject(error);
    });
  });
}

// Retrieve a secret from Key Vault
async function getSecret(name) {
  const storage = new Storage();

  const kmsClient = new kms.KeyManagementServiceClient();
  const secretBucket = storage.bucket(process.env.SECRETS_BUCKET_NAME);

  const file = secretBucket.file(name);

  try {
    if (process.env.DEBUG)
      console.log(`Got secret file from bucket ${name}`);

    const cryptoname = kmsClient.cryptoKeyPath(
      process.env.GCP_PROJECT,
      process.env.LOCATION,
      process.env.KEYRING_ID,
      process.env.CRYPTOKEY_ID
    );

    const fileContents = await readFile(file);

    // Decrypts the file using the specified crypto key
    //const b64secret = Buffer.from(fileContents).toString('base64');
    const [result] = await kmsClient.decrypt({name: cryptoname, ciphertext: Buffer.from(fileContents)});
    console.log(Buffer.from(result.plaintext, 'base64').toString('utf8').trim());
  } catch(err) {
    if (process.env.DEBUG)
      console.log('Error retrieving secret', err);
    process.exit(1)
  }
}

(async () => {
  if (!process.env.GCP_PROJECT || !process.env.LOCATION || !process.env.KEYRING_ID || !process.env.CRYPTOKEY_ID || !process.env.SECRETS_BUCKET_NAME) {
    console.log('Some essential ENV Vars for secret gathering missing');
    process.exit(1);
  } else {
    if( process.argv.length == 3 )
      await getSecret(process.argv[2]);
    else {
      console.log('You must provide a secret name');
      process.exit(1)
    }
  }
})();