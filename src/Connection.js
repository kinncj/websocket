import {EventEmitter} from 'events';
import crypto         from 'crypto';
import InStream       from './InStream';
import OutStream      from './OutStream';
import frame          from './frame';
import Server         from './Server';

export default class Connection extends EventEmitter
{
    constructor(socket, parentOrUrl, callback)
    {
        super();

        this.setupParameters(parentOrUrl);

        this.socket      = socket;
        this.readyState  = Connection.CONNECTING;
        this.buffer      = new Buffer(0);
        this.frameBuffer = null; // string for text frames and InStream for binary frames
        this.outStream   = null; // current allocated OutStream object for sending binary frames
        this.key         = null; // the Sec-WebSocket-Key header
        this.headers     = {}; // read only map of header names and values. Header names are lower-cased

        this.registerListeners(callback);
    }

    setupParameters(parentOrUrl)
    {
        this.server       = parentOrUrl;
        this.path         = null;
        this.host         = null;
        this.extraHeaders = null;
    }

    registerListeners(callback) {
        // Set listeners
        this.socket.on('readable', function () {
            this.doRead();
        }.bind(this));

        this.socket.on('error', function (err) {
            this.emit('error', err);
        }.bind(this));

        this.socket.once('close', this.onClose.bind(this));
        this.socket.once('finish', this.onClose.bind(this));

        if (callback) {
            this.once('connect', callback);
        }
    }

    onClose()
    {
        if (this.readyState === Connection.CONNECTING || this.readyState === Connection.OPEN) {
            this.emit('close', 1006, '');
        }

        this.readyState = Connection.CLOSED;

        if (this.frameBuffer instanceof InStream) {
            this.frameBuffer.end();
            this.frameBuffer = null;
        }
        if (this.outStream instanceof OutStream) {
            this.outStream.end();
            this.outStream = null;
        }
    }

    sendText(str, callback)
    {
        if (this.readyState === Connection.OPEN) {
            if (!this.outStream) {
                return this.socket.write(frame.createTextFrame(str, !this.server), callback);
            }
            this.emit('error', new Error('You can\'t send a text frame until you finish sending binary frames'));
        }
        this.emit('error', new Error('You can\'t write to a non-open connection'));
    }

    beginBinary()
    {
        if (this.readyState === Connection.OPEN) {
            if (!this.outStream) {
                return (this.outStream = new OutStream(this, Connection.binaryFragmentation));
            }
            this.emit('error', new Error('You can\'t send more binary frames until you finish sending the previous binary frames'));
        }
        this.emit('error', new Error('You can\'t write to a non-open connection'));
    }

    sendBinary(data, callback)
    {
        if (this.readyState === Connection.OPEN) {
            if (!this.outStream) {
                return this.socket.write(frame.createBinaryFrame(data, !this.server, true, true), callback);
            }
            this.emit('error', new Error('You can\'t send more binary frames until you finish sending the previous binary frames'));
        }
        this.emit('error', new Error('You can\'t write to a non-open connection'));
    }

    send(data, callback)
    {
        if (typeof data === 'string') {
            this.sendText(data, callback);
        } else if (Buffer.isBuffer(data)) {
            this.sendBinary(data, callback);
        } else {
            throw new TypeError('data should be either a string or a Buffer instance');
        }
    }

    sendPing(data)
    {
        if (this.readyState === Connection.OPEN) {
            return this.socket.write(frame.createPingFrame(data || '', !this.server));
        }
        this.emit('error', new Error('You can\'t write to a non-open connection'));
    }

    close(code, reason)
    {
        if (this.readyState === Connection.OPEN) {
            this.socket.write(frame.createCloseFrame(code, reason, !this.server));
            this.readyState = Connection.CLOSING;
        } else if (this.readyState !== Connection.CLOSED) {
            this.socket.end();
            this.readyState = Connection.CLOSED;
        }
        this.emit('close', code, reason);
    }

    doRead()
    {
        let buffer, temp;

        // Fetches the data
        buffer = this.socket.read();
        if (!buffer) {
            // Waits for more data
            return;
        }

        // Save to the internal buffer
        this.buffer = Buffer.concat([this.buffer, buffer], this.buffer.length + buffer.length);

        if (this.readyState === Connection.CONNECTING) {
            if (!this.readHandshake()) {
                // May have failed or we're waiting for more data
                return;
            }
        }

        if (this.readyState !== Connection.CLOSED) {
            // Try to read as many frames as possible
            while ((temp = this.extractFrame()) === true) {}
            if (temp === false) {
                // Protocol error
                this.close(1002);
            } else if (this.buffer.length > Connection.maxBufferLength) {
                // Frame too big
                this.close(1009);
            }
        }
    }

    startHandshake()
    {
        let str, i, key, headers, header;

        key = new Buffer(16);

        for (i = 0; i < 16; i++) {
            key[i] = Math.floor(Math.random() * 256);
        }

        this.key = key.toString('base64');

        headers = {
            'Host':                  this.host,
            'Upgrade':               'websocket',
            'Connection':            'Upgrade',
            'Sec-WebSocket-Key':     this.key,
            'Sec-WebSocket-Version': '13'
        };

        for (header in this.extraHeaders) {
            headers[header] = this.extraHeaders[header];
        }

        str = this.buildRequest('GET ' + this.path + ' HTTP/1.1', headers);

        this.socket.write(str);
    }

    readHandshake()
    {
        let found = false;

        let i, data;

        // Do the handshake and try to connect
        if (this.buffer.length > Connection.maxBufferLength) {
            // Too big for a handshake
            this.socket.end(this.server ? 'HTTP/1.1 400 Bad Request\r\n\r\n' : undefined);

            return false;
        }

        // Search for '\r\n\r\n'
        for (i = 0; i < this.buffer.length - 3; i++) {
            if (this.buffer[i] === 13 && this.buffer[i + 2] === 13 &&
                this.buffer[i + 1] === 10 && this.buffer[i + 3] === 10) {
                found = true;
                break;
            }
        }
        if (!found) {
            // Wait for more data
            return false;
        }

        data = this.buffer.slice(0, i + 4).toString().split('\r\n');

        if (this.server ? this.answerHandshake(data) : this.checkHandshake(data)) {
            this.buffer = this.buffer.slice(i + 4);
            this.readyState = Connection.OPEN;
            this.emit('connect');
            return true
        } else {
            this.socket.end(this.server ? 'HTTP/1.1 400 Bad Request\r\n\r\n' : undefined);
            return false;
        }
    }

    readHeaders(lines)
    {
        let i, match;

        // Extract all headers
        // Ignore bad-formed lines and ignore the first line (HTTP header)
        for (i = 1; i < lines.length; i++) {
            if ((match = lines[i].match(/^([a-z-]+): (.+)$/i))) {
                this.headers[match[1].toLowerCase()] = match[2];
            }
        }
    }

    checkHandshake(lines)
    {
        let key, sha1;

        // First line
        if (lines.length < 4) {
            return false;
        }

        if (!lines[0].match(/^HTTP\/\d\.\d 101( .*)?$/i)) {
            return false;
        }

        // Extract all headers
        this.readHeaders(lines);

        // Validate necessary headers
        if (!('upgrade' in this.headers) ||
            !('sec-websocket-accept' in this.headers) ||
            !('connection' in this.headers)) {
            return false;
        }
        if (this.headers.upgrade.toLowerCase() !== 'websocket' ||
            this.headers.connection.toLowerCase().split(', ').indexOf('upgrade') === -1) {
            return false;
        }
        key = this.headers['sec-websocket-accept'];

        // Check the key
        sha1 = crypto.createHash('sha1');
        sha1.end(this.key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11');

        return (key !== sha1.read().toString('base64'));
    }

    answerHandshake(lines)
    {
        let path, key, sha1;

        // First line
        if (lines.length < 6) {
            return false;
        }
        path = lines[0].match(/^GET (.+) HTTP\/\d\.\d$/i)
        if (!path) {
            return false;
        }
        this.path = path[1];

        // Extract all headers
        this.readHeaders(lines);

        // Validate necessary headers
        if (!('host' in this.headers) ||
            !('sec-websocket-key' in this.headers) ||
            !('upgrade' in this.headers) ||
            !('connection' in this.headers)) {
            return false;
        }
        if (this.headers.upgrade.toLowerCase() !== 'websocket' ||
            this.headers.connection.toLowerCase().split(', ').indexOf('upgrade') === -1) {
            return false;
        }
        if (this.headers['sec-websocket-version'] !== '13') {
            return false;
        }

        this.key = this.headers['sec-websocket-key'];

        // Build and send the response
        sha1 = crypto.createHash('sha1');
        sha1.end(this.key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
        key = sha1.read().toString('base64')
        this.socket.write(this.buildRequest('HTTP/1.1 101 Switching Protocols', {
            'Upgrade':             'websocket',
            'Connection':          'Upgrade',
            'Sec-WebSocket-Accept': key
        }));
        return true;
    }

    extractFrame()
    {
        let fin, opcode, B, HB, mask, len, payload, start, i, hasMask;

        if (this.buffer.length < 2) {
            return;
        }

        // Is this the last frame in a sequence?
        B  = this.buffer[0];
        HB = B >> 4;

        if (HB % 8) {
            // RSV1, RSV2 and RSV3 must be clear
            return false;
        }

        fin    = HB === 8;
        opcode = B % 16;

        if (opcode !== 0 && opcode !== 1 && opcode !== 2 &&
            opcode !== 8 && opcode !== 9 && opcode !== 10) {
            // Invalid opcode
            return false;
        }
        if (opcode >= 8 && !fin) {
            // Control frames must not be fragmented
            return false;
        }

        B       = this.buffer[1];
        hasMask = B >> 7;

        if ((this.server && !hasMask) || (!this.server && hasMask)) {
            // Frames sent by clients must be masked
            return false;
        }
        len   = B % 128;
        start = hasMask ? 6 : 2;

        if (this.buffer.length < start + len) {
            // Not enough data in the buffer
            return;
        }

        // Get the actual payload length
        if (len === 126) {
            len = this.buffer.readUInt16BE(2);
            start += 2;
        } else if (len === 127) {
            // Warning: JS can only store up to 2^53 in its number format
            len = this.buffer.readUInt32BE(2) * Math.pow(2, 32) + this.buffer.readUInt32BE(6);
            start += 8;
        }
        if (this.buffer.length < start + len) {
            return;
        }

        // Extract the payload
        payload = this.buffer.slice(start, start + len)
        if (hasMask) {
            // Decode with the given mask
            mask = this.buffer.slice(start - 4, start)
            for (i = 0; i < payload.length; i++) {
                payload[i] ^= mask[i % 4];
            }
        }
        this.buffer = this.buffer.slice(start + len);

        // Proceeds to frame processing
        return this.processFrame(fin, opcode, payload);
    }

    processFrame(fin, opcode, payload)
    {
        if (opcode === 8) {
            // Close frame
            if (this.readyState === Connection.CLOSING) {
                this.socket.end()
            } else if (this.readyState === Connection.OPEN) {
                this.processCloseFrame(payload);
            }
            return true
        } else if (opcode === 9) {
            // Ping frame
            if (this.readyState === Connection.OPEN) {
                this.socket.write(frame.createPongFrame(payload.toString(), !this.server));
            }
            return true
        } else if (opcode === 10) {
            // Pong frame
            this.emit('pong', payload.toString());
            return true;
        }

        if (this.readyState !== Connection.OPEN) {
            // Ignores if the connection isn't opened anymore
            return true;
        }

        if (opcode === 0 && this.frameBuffer === null) {
            // Unexpected continuation frame
            return false;
        } else if (opcode !== 0 && this.frameBuffer !== null) {
            // Last sequence didn't finished correctly
            return false;
        }

        if (!opcode) {
            // Get the current opcode for fragmented frames
            opcode = typeof this.frameBuffer === 'string' ? 1 : 2;
        }

        if (opcode === 1) {
            // Save text frame
            payload = payload.toString();
            this.frameBuffer = this.frameBuffer ? this.frameBuffer + payload : payload;

            if (fin) {
                // Emits 'text' event
                this.emit('text', this.frameBuffer);
                this.frameBuffer = null;
            }
        } else {
            // Sends the buffer for InStream object
            if (!this.frameBuffer) {
                // Emits the 'binary' event
                this.frameBuffer = new InStream;
                this.emit('binary', this.frameBuffer);
            }
            this.frameBuffer.addData(payload);

            if (fin) {
                // Emits 'end' event
                this.frameBuffer.end();
                this.frameBuffer = null;
            }
        }

        return true;
    }

    processCloseFrame(payload)
    {
        let code, reason;

        if (payload.length >= 2) {
            code   = payload.readUInt16BE(0);
            reason = payload.slice(2).toString();
        } else {
            code   = 1005;
            reason = '';
        }
        this.socket.write(frame.createCloseFrame(code, reason, !this.server));
        this.readyState = Connection.CLOSED;
        this.emit('close', code, reason);
    }

    buildRequest(requestLine, headers)
    {
        let headerString = requestLine + '\r\n';

        let headerName;

        for (headerName in headers) {
            headerString += headerName + ': ' + headers[headerName] + '\r\n';
        }

        return headerString + '\r\n';
    }
}

Connection.binaryFragmentation = 512 * 1024; // .5 MiB
Connection.maxBufferLength     = 2 * 1024 * 1024; // 2 MiB
Connection.CONNECTING          = 0;
Connection.OPEN                = 1;
Connection.CLOSING             = 2;
Connection.CLOSED              = 3;