/**
 * webpack-dev-server-lancher
 * Created by jady on 2016/8/12.
 */

var urlUtil = require("url");
var webpack = require("webpack");
var WebpackDevServer = require("webpack-dev-server");
var httpProxy = require("http-proxy");
var mock = require("express-mock-api");

var webpackConfig;
var options;
var serverApp;

/**
 * 获得webpack的config信息
 * @returns {*}
 */
function getWebpackConfig() {
    var devClient = [`webpack-dev-server/client?${options.protocol}://${options.host}:${options.port}`];

    if (options.hot) {
        devClient.push("webpack/hot/dev-server");
        webpackConfig.plugins.push(new webpack.HotModuleReplacementPlugin());
    }

    if (typeof webpackConfig.entry === "object" && !Array.isArray(webpackConfig.entry)) {
        Object.keys(webpackConfig.entry).forEach(function(key) {
            webpackConfig.entry[key] = devClient.concat(webpackConfig.entry[key]);
        });
    } else {
        webpackConfig.entry = devClient.concat(webpackConfig.entry);
    }

    return webpackConfig;
}

/**
 * 初始化开发服务器
 * @returns {Server}
 */
function initDevServer(config) {
    webpackConfig = config.webpack;
    options = webpackConfig.devServer;
    serverApp = config.serverApp;

    // 如果同时存在proxy和mock的配置，那就先把proxy的配置拿掉。这么做是因为需要保证mock配置的优先级高于proxy
    var proxyConfig = options.proxy;
    var mockRoot = config.mock;
    if (proxyConfig && mockRoot) delete options.proxy;

    // 初始化webpack dev server
    options.publicPath = webpackConfig.output.publicPath;
    var server = new WebpackDevServer(webpack(getWebpackConfig()), options);

    // 如果存在mock的跟路径，初始化mock功能
    if (mockRoot) {
        var mockOptions = {
            root: mockRoot
        };

        // 把webpack中的publicPath设置到忽略路径
        var publicPath = webpackConfig.output.publicPath;
        if (publicPath) {
            if (publicPath.charAt(0) == "/") {
                // 如果是 /path 格式
                mockOptions.ignore = publicPath;
            } else if (publicPath.indexOf("http://") == 0 || publicPath.indexOf("https://") == 0) {
                // 如果是 http://...或者https://... 格式
                var urlObj = urlUtil.parse(publicPath);
                mockOptions.ignore = urlObj.pathname;
            }
        }

        server.app.use(mock(mockOptions));
    }

    // 初始化proxy
    if (proxyConfig && mockRoot) initProxy(proxyConfig, server);

    // 如果存在server app，那就加入进来
    if (serverApp) {
        server.app.use(serverApp);
    }

    // 启动server
    server.listen(options.port, options.host);
    console.log(`server is running on ${options.host}:${options.port}`);

    return server;
}

/**
 * 初始化proxy
 * @param config
 * @param app
 */
function initProxy(config, server) {
    // 注意：杰华：基本复制自webpack

    var proxy = new httpProxy.createProxyServer({secure: false});

    if (!Array.isArray(config)) {
        config = Object.keys(config).map(function (path) {
            var proxyOptions;
            if (typeof config[path] === 'string') {
                proxyOptions = {path: path, target: config[path]};
            } else {
                proxyOptions = config[path];
                proxyOptions.path = path;
            }
            return proxyOptions;
        });
    }

    config.forEach(function (proxyOptions) {
        proxyOptions.ws = proxyOptions.hasOwnProperty('ws') ? proxyOptions.ws : true;
        server.app.all(proxyOptions.path, function (req, res, next) {
            var bypassUrl = typeof proxyOptions.bypass === 'function' ? proxyOptions.bypass(req, res, proxyOptions) : false;
            if (bypassUrl) {
                req.url = bypassUrl;
                next();
            } else {
                if(typeof proxyOptions.rewrite === 'function') proxyOptions.rewrite(req, proxyOptions);
                if (proxyOptions.host) {
                    req.headers.host = proxyOptions.host;
                }
                proxy.web(req, res, proxyOptions, function(err){
                    var msg = "cannot proxy to " + proxyOptions.target + " (" + err.message + ")";
                    server.sockWrite(server.sockets, "proxy-error", [msg]);
                    res.statusCode = 502;
                    res.end();
                });
                if (proxyOptions.configure) {
                    proxyOptions.configure(proxy);
                }
            }
        });
    });
}

module.exports = initDevServer;