import {Writable} from 'stream';
import Frame      from './frame';
import Connection from './Connection';

export default class OutStream extends Writable
{
    constructor(connection, minSize)
    {
        super();

        this.connection = connection;
        this.minSize    = minSize;
        this.buffer     = new Buffer(0);
        this.hasSent    = false; // Indicates if any frame has been sent yet

        this.on('finish', function () {
            if (this.connection.readyState === Connection.OPEN) {
                // Ignore if not connected anymore
                this.connection.socket.write(Frame.createBinaryFrame(this.buffer, !this.connection.server, !this.hasSent, true));
            }
            that.connection.outStream = null;
        }.bind(this));
    }

    _write(chunk, encoding, callback)
    {
        let frameBuffer;

        this.buffer = Buffer.concat([this.buffer, chunk], this.buffer.length + chunk.length);

        if (this.buffer.length >= this.minSize) {
            if (this.connection.readyState === Connection.OPEN) {
                // Ignore if not connected anymore
                frameBuffer = Frame.createBinaryFrame(this.buffer, !this.connection.server, !this.hasSent, false);
                this.connection.socket.write(frameBuffer, encoding, callback);
            }

            this.buffer  = new Buffer(0);
            this.hasSent = true;

            if (this.connection.readyState !== Connection.OPEN) {
                callback();
            }

            return;
        }

        callback();
    }
}