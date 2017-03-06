'use strict';

const router = module.exports.router = function router(){

	// defaults
	this.routes = []
	this.static_routes = {}
	this.dynamic_routes = []
	this.middlewares = []
	this.middleware_count = 0
	this.static_count = 0
	this.dynamic_count = 0
    this.route_count = 0
}

/**
 * Extract params and mutates route object accordingly
 * @param {object} route
 * @return {boolean} true if route expects params, false if not
**/
const paramsParser = module.exports.paramsParser = function paramsParser(route){

	const first_bracket_pos = route.path.indexOf('[')
	if( first_bracket_pos < 0 ) return false;

	route.params = []

	// store the partial path
	// we need it to do a partial url string equality
	// before doing the test regex
	route.partial_path = route.path.substr(0, first_bracket_pos)
	route.partial_length = first_bracket_pos

	// replace any regex reserved characters
	route.test = route.match = route.path.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

	// build test and match regex ( as a string for now )
	route.test = route.test.replace(/\\\[(.*?)\\\]/g, function(match, submatch){
		route.params.push( submatch )
		return '[^\/]+'; // one or more characters excluding / ( forward slash )
	})

	route.match = route.match.replace(/\\\[(.*?)\\\]/g, function(match){
		return '(.*)';
	})

	route.params_length = route.params.length

	route.testRegex = new RegExp( '^' + route.test + '$')
	route.matchRegex = new RegExp( '^' + route.match + '$')

	return true;
}

/**
 * determine if a route is static ( not dynamic )
 * so we can store it under static_routes[method:path] = its route index
 * in order to perform the quickest route match via if(object[key]) before everything else
 * @param {object} route
 * @return {boolean} true if route expects params, false if not
**/
const isStatic = module.exports.isStatic = function isStatic(route){
	// has params - not static
	if( route.path.indexOf('[') >= 0 ) return false
	// its a wildcard - not static ( not yet implemented )
	if( route.path.indexOf('*') >= 0 ) return false;

	return true;
}

const wildcardParser = module.exports.wildcardParser = function wildcardParser(route){

	let wildcard_pos = route.path.indexOf('*')
	if( wildcard_pos < 0 ) return false;

	route.partial_path = route.path.substr(0, wildcard_pos)
	route.partial_length = wildcard_pos
	route.params_length = 0;

	route.test = route.match = route.path.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

	route.test = route.test.replace(/\\\*/g, function(match, submatch){
		route.params_length++
		return '[^\/]+'; // one or more characters excluding / ( forward slash )
	})

	route.match = route.match.replace(/\\\*/g, function(match){
		return '(.*)';
	})

	route.testRegex = new RegExp( '^' + route.test + '$')
	route.matchRegex = new RegExp( '^' + route.match + '$')

	return true
}

router.prototype.get = function(route){
	route.method = 'GET'
	this.add(route);
}

router.prototype.post = function(route){
	route.method = 'POST'
	this.add(route);
}

router.prototype.add = function(route){
	// do not proceed without a path, method or handlers
	if( !route.path ||
		!route.method ||
		!route.handlers)
		return;

	if( isStatic(route) ){
		this.static_routes[route.method + ':' + route.path] = this.route_count
		this.static_count++
	}
	if( paramsParser(route) ){
		this.dynamic_routes.push( this.route_count )
		this.dynamic_count++
	}
	if( wildcardParser(route) ){
		this.dynamic_routes.push( this.route_count )
		this.dynamic_count++
	}

	route.handlersCount = route.handlers.length

    this.routes.push(route)
    this.route_count++
}

router.prototype.use = function use(){
	for(let i in arguments){
		this.middleware_count++
		this.middlewares.push(arguments[i])
	}
}

router.prototype.callback = function callback(){
	return function handleRequest(req, res){
		_this.handleRequest(req, res)
	}
}

router.prototype.handleRequest = function handleRequest(req, res){

	// first call
	if( typeof res.locals == 'undefined' ){

		req.router = this
		req.routeIndex = -1;
		req.handlerIndex = -1;
		req.middlewareIndex = -1
		res.locals = {}

		if(this.middleware_count != 0){
			req.middlewares = this.middlewares
			req.next = this.nextMiddleware
			req.next();
			return;
		}
	}


	// check for a static route first
	if( typeof this.static_routes[ req.method+':'+req.url ] != 'undefined'){
		req.routeIndex = this.static_routes[ req.method+':'+req.url ]
	}else if(this.dynamic_count != 0){
		let i = 0;
		while(1){
			req.routeIndex = this.dynamic_routes[i++]
			// request method doesnt match this route method.. proceed to next route
			if( req.method !== this.routes[req.routeIndex].method ) continue;

			if( req.url.substring(0, this.routes[req.routeIndex].partial_length) &&
				this.routes[req.routeIndex].testRegex.test(req.url) ){
				break;
			}

			// end of dynamic routes
			if( i >= this.dynamic_count ){
				//console.log('shoud break')
				req.routeIndex = -1
				break;
			}
		}
	}

	if (req.routeIndex < 0){
		res.writeHead(404)
		res.end('Not Found')
		return;
	}

	let this_route = this.routes[req.routeIndex]

	// route expects params
	if( this_route.matchRegex ){

		let param_matches = req.url.match( this_route.matchRegex )
		req.params = {}

		if( ! this_route.params ){ // manage wildcard
			for(let i = 0; i < this_route.params_length; i++ ){
				if( param_matches[i+1] ) req.params[ i ] = param_matches[i+1]
			}
		}else{ // manage params
			for(let i = 0; i < this_route.params_length; i++ ){
				if( param_matches[i+1] ) req.params[ this_route.params[i] ] = param_matches[i+1]
			}
		}
	}

	//console.log('after middleware')
	req.next = this.nextHandler
	req.next()
}

router.prototype.nextHandler = function nextHandler(err){
	let req = this, router = this.router, this_route = router.routes[ req.routeIndex ];

	req.handlerIndex++

	if( typeof this_route.handlers[ req.handlerIndex ] == 'undefined' ) return;
	this_route.handlers[ req.handlerIndex ](req, req.client._httpMessage)
}

router.prototype.nextMiddleware = function nextMiddleware(err){
	let req = this
	req.middlewareIndex++
	if( typeof req.middlewares[ req.middlewareIndex ] == 'undefined' ){
		req.router.handleRequest(req, req.client._httpMessage)
		return;
	}
	req.middlewares[ req.middlewareIndex ](req, req.client._httpMessage)
}
