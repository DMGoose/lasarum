export class LocalDatabase{
 constructor(indexedDB=globalThis.indexedDB){this.indexedDB=indexedDB;}
 async open(){if(this.db)return;this.db=await new Promise((resolve,reject)=>{const request=this.indexedDB.open('lasrum.cloud.v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('accounts');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
 async load(account){await this.open();return new Promise((resolve,reject)=>{const request=this.db.transaction('accounts').objectStore('accounts').get(account);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
 async save(account,state){await this.open();return new Promise((resolve,reject)=>{const transaction=this.db.transaction('accounts','readwrite');transaction.objectStore('accounts').put(structuredClone(state),account);transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||new Error('Local save was interrupted.'));});}
 close(){this.db?.close();this.db=null;}
}
