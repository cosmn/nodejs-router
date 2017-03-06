### Node JS routing done simple

```js
const http = require('http')
const router = require('path/to/router').router
const route = new router();

route.get({
	path : '/',
	handlers : [
		indexHandler
	]
})

function indexHandler(req, res){
	res.end('index page')
}

httpServer = http.createServer(route.callback())
httpServer.listen(3000)
