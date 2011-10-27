var express = require('express'),
       gzip = require('connect-gzip'),
     stylus = require("stylus"),
 RedisStore = require('connect-redis')(express),
  everyauth = require('everyauth'),
        app = module.exports = express.createServer(),
     config = require("./config"),
      redis = require("redis").createClient(config.redis.port, config.redis.host);

// Load App info from package.json
var appinfo;
require("fs").readFile(__dirname + "/package.json", function(err, data){
  appinfo = JSON.parse(data);
});

// fetch all user-info from redis
var usersById = {},
    userIdByKey = {},
    usertable = config.redis.userHashTable;

redis.hgetall(usertable, function(err, hash){
  if(err){
    console.error("Failed fetching User info. Wont start");
    process.exit(-1);
  }
  var user, id;
  for(var key in hash){
    user = JSON.parse(hash[key]);
    id = user.id;
    userIdByKey[key] = id;
    usersById[id] = user;
  }
  console.info("fetched user info from redis");
});

// twitter & github auth
var services = ["twitter", "github"];
services.forEach(function(service){
  var conf = config[service];
  var auth = everyauth[service];
  for(var info in conf){
    auth[info](conf[info]);
  }
  auth.entryPath('/login/' + service)
    .callbackPath('/login/' + service + '/callback')
    .findOrCreateUser(function (session, token, secret, userdata) {
      var key = service + userdata.id;
      var user;
      if(key in userIdByKey) {
        user = usersById[userIdByKey[key]];
      } else {
        user = {
          "key" : service + userdata.id,
          "karma" : 10
        };
        //user[service] = { "id" : userdata.id };
        switch(service){
          case "twitter":
            user.name = userdata.screen_name;
            user.thumbnail = userdata.profile_image_url;
            user.url = userdata.url;
            break;
          case "github":
            user.name = userdata.login;
            user.thumbnail = "http://www.gravatar.com/avatar/" + userdata.gravatar_id;
            user.url = userdata.blog;
            break;
        }
        var id = user.name.toLowerCase();
        user["id"] = id;
        usersById[id] = user;
        userIdByKey[key] = id;
        redis.hset(usertable, key, JSON.stringify(user));
      }
      session.user = user;
      return user;
    }).redirectPath('/');
});


// App Configuration
app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(stylus.middleware({
    src: __dirname + '/src',
    dest: __dirname + '/static',
    compile: function (str, path, fn) {
      return stylus(str).set('filename', path).set('compress', true);
    }
  }));
  app.use(express.favicon(__dirname + '/static/favicon.ico'));
  app.use(express.cookieParser());
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.session({ 
    key: config.sessions.key,
    secret: config.sessions.secret,
    cookie: { 
      path: '/', 
      httpOnly: true, 
      maxAge: config.sessions.expires 
    },
    store: new RedisStore() 
  }));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
  app.use(express.static(__dirname + '/static'));
});

app.configure('production', function(){
  app.enable('view cache');
  app.use(express.errorHandler());
  app.use(gzip.staticGzip(__dirname + '/static', { maxAge: 86400*365 }));
});

app.configure(function(){
  app.use(everyauth.middleware());
  everyauth.helpExpress(app);
  app.use(app.router);
});

// Generic info across pages
app.dynamicHelpers({
  app: function(req, resp){
    return appinfo;
  },
  user: function (req, res) {
    return req.session.user || {};
  }
});


// Routes
app.get('/', function(req, resp){
  resp.render('index', {
    title: 'Top News'
  });
});

app.get('/login', function(req, resp){
  resp.render("login", {
    title: 'login'
  });
});

app.post('/login', function(req, resp){
  // TODO: implement password based login system
  resp.end();
});

app.get("/logout", function(req, resp){
  req.session.destroy(function(err){
    if(err){
      console.log(err);
    }
    resp.redirect("/");
  });
});

app.get('/news/:newsid', function(req, resp){
  
});

app.get('/user/:userid', function(req, resp){
  resp.write(JSON.stringify(usersById[req.params.userid]||{}));
  resp.end();
})

app.get('/about/changelog', function(req, resp){
  
});

// Catch all route
app.use(function(eq, resp){
  resp.redirect("/");
});

// start the server now, if the module is not "require"'d from elsewhere
if (!module.parent) {
  app.listen(process.env.app_port || 3000);
  console.info("Listening on port %d in %s mode", app.address().port, app.settings.env);
}
