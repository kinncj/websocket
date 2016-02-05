import Server     from './Server.js';
import Connection from './Connection.js';
import net        from 'net';
import tls        from 'tls';
import url        from 'url';

const CONNECTION_TYPES = [net, tls];

export default class Main
{
    static createServer(options, callback)
    {
        if (typeof options === 'function' || !arguments.length) {
            return new Server(false, options);
        }

        return new Server(Boolean(options.secure), options, callback);
    }

    static setBinaryFragmentation(bytes)
    {
        Connection.binaryFragmentation = bytes;
    }

    static setMaxBufferLength(bytes)
    {
        Connection.maxBufferLength = bytes;
    }

    static _parseWSURL(URL) {
        let parts, secure;

        parts = url.parse(URL);

        parts.protocol = parts.protocol || 'ws:';
        if (parts.protocol === 'ws:') {
            secure = false;
        } else if (parts.protocol === 'wss:') {
            secure = true;
        } else {
            throw new Error('Invalid protocol ' + parts.protocol + '. It must be ws or wss');
        }

        parts.port = parts.port || (secure ? 443 : 80);
        parts.path = parts.path || '/';

        return {
            path:   parts.path,
            port:   parts.port,
            secure: secure,
            host:   parts.hostname
        };
    }
}