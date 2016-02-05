import main from "./index.js";

global.LOG_LEVEL = 'info';

const PORT = 8001;

export default class TestServer
{
    constructor()
    {
        let logger = new main.Logger("TestServer");

        main.Main.createServer(function (conn) {
            conn.on("text", function (str) {
                logger.info("Received " + str);
                conn.sendText(str.toUpperCase() + "!!!");
            });
            conn.on("close", function (code, reason) {
                logger.info("Connection closed");
            });
        }).listen(PORT, () => logger.info(`Started at ${PORT}`));
    }
}