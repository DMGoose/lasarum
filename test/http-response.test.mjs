import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTTPResponse} from '../supabase/functions/_shared/http-response.mjs';
const encode=value=>new TextEncoder().encode(value);
test('edge HTTP response decoding preserves Swedish UTF-8 and bounded chunk framing',()=>{
 const text='Åsa läser svenska.',bytes=encode(text);
 const head=encode(`HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.length}\r\n\r\n`);
 const message=new Uint8Array(head.length+bytes.length);message.set(head);message.set(bytes,head.length);
 assert.equal(parseHTTPResponse(message).body,text);
 assert.equal(parseHTTPResponse(encode('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2;x=y\r\nde\r\n0\r\n\r\n')).body,'abcde');
 assert.equal(parseHTTPResponse(encode('HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/private\r\n\r\n')).location,'http://127.0.0.1/private');
});
test('edge HTTP response decoding rejects truncation, ambiguous framing, oversized chunks and binary files',()=>{
 for(const headers of ['Content-Length: 9','Transfer-Encoding: chunked\r\nContent-Length: 3','Transfer-Encoding: gzip'])assert.throws(()=>parseHTTPResponse(encode(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n${headers}\r\n\r\nabc`)),/invalid response/);
 assert.throws(()=>parseHTTPResponse(encode('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n1400001\r\n')),/too large/);
 assert.throws(()=>parseHTTPResponse(encode('HTTP/1.1 200 OK\r\nContent-Type: image/png\r\n\r\nabc')),/not an HTML/);
 assert.throws(()=>parseHTTPResponse(encode('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nabc')),/invalid response/);
});
