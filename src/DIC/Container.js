import Bottle from "../../node_modules/bottlejs/dist/bottle.js";

import Main from "../index.js";

let bottle = new Bottle();

bottle.factory('Main', function(){
    return Main;
});

export default bottle.container;