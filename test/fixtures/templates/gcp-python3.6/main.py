from google.cloud import pubsub_v1
import base64
import os
import json
import furnace
import asyncio

def message_sent_callback(message_future):
    # When timeout is unspecified, the exception method waits indefinitely.
    if message_future.exception(timeout=30):
        print('Publishing message threw an Exception {}.'.format(message_future.exception()))
    else:
        print(message_future.result())

async def process(data, context):
    """Background Cloud Function.
    Args:
         data (dict): The dictionary with data specific to the given event.
         context (google.cloud.functions.Context): The Cloud Functions event
         metadata.
    """

    if 'data' in data:
        event = json.loads(base64.b64decode(data['data']).decode('utf-8'))

        if event is not None:
            processed_result = await furnace.processEvent(event)

            if 'STREAM_NAME' in os.environ:
                publisher = pubsub_v1.PublisherClient()
                topic_path = publisher.topic_path(os.getenv('GCP_PROJECT'), os.getenv('STREAM_NAME'))

                data = str(json.dumps(processed_result)).encode('utf-8')
                
                # When you publish a message, the client returns a Future.
                message_future = publisher.publish(topic_path, data=data)
                message_future.add_done_callback(message_sent_callback)
