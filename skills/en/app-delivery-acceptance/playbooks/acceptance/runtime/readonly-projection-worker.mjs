import {parentPort,workerData} from 'node:worker_threads';
import {readOnlyProjection} from './role-contract.mjs';
parentPort.postMessage(readOnlyProjection(workerData.root,workerData.output));
