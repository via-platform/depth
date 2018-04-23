const {Disposable, CompositeDisposable, Emitter, Orderbook} = require('via');
const _ = require('underscore-plus');
const base = 'via://depth';
const RBTree = require('bintrees').RBTree;
const d3 = require('d3');
const {throttle} = require('frame-throttle');
const etch = require('etch');
const $ = etch.dom;

const AXIS_HEIGHT = 24;
//TODO make this a user configurable option, but it might cause lag if it's too low
const SCALE_EXTENT = 0.25;
const TOLERANCE = 0.01;
const FLAG_WIDTH = 71;

module.exports = class Depth {
    static deserialize(params){
        return new Depth(params);
    }

    serialize(){
        return {
            deserializer: 'Depth',
            uri: this.getURI()
        };
    }

    constructor(params = {}){
        this.disposables = new CompositeDisposable();
        this.emitter = new Emitter();
        this.uri = params.uri;
        this.width = 0;
        this.height = 0;
        this.tolerance = TOLERANCE;
        this.draw = throttle(this.draw.bind(this));
        this.mid = 0;
        this.transform = null;
        this.path = this.path.bind(this);
        this.cursor = 0;
        this.omnibar = params.omnibar;
        this.orderbook = null;
        this.market = null;
        this.bids = [];
        this.asks = [];

        this.basis = {
            x: d3.scaleLinear().domain([-100, 100]),
            y: d3.scaleLinear().domain([100, 0])
        };

        this.scale = {
            x: this.basis.x.copy(),
            y: this.basis.y.copy()
        };

        etch.initialize(this);
        this.changeMarket(via.markets.findByIdentifier(this.getURI().slice(base.length + 1)));

        this.disposables.add(via.commands.add(this.element, {
            'depth:change-market': this.change.bind(this),
            'depth:zoom-in': () => this.zoomBy(2),
            'depth:zoom-out': () => this.zoomBy(0.5)
        }));

        this.chart = d3.select(this.refs.chart).append('svg');
        this.clip = this.chart.append('clipPath').attr('id', 'depth-clip').append('rect').attr('x', 0).attr('y', 0);

        this.paths = this.chart.append('g').attr('class', 'areas').attr('clip-path', 'url(#depth-clip)');
        this.footer = this.chart.append('rect').attr('class', 'footer').attr('height', AXIS_HEIGHT);

        this.axis = {
            bottom: {
                basis: d3.axisBottom(this.scale.x).tickPadding(4).tickSizeOuter(0),
                element: this.chart.append('g').attr('class', 'x axis bottom')
            },
            left: {
                basis: d3.axisRight(this.scale.y).ticks(4).tickSizeOuter(0),
                element: this.chart.append('g').attr('class', 'y axis left')
            },
            right: {
                basis: d3.axisLeft(this.scale.y).ticks(4).tickSizeOuter(0),
                element: this.chart.append('g').attr('class', 'y axis right')
            }
        };

        const crosshairs = this.chart.append('g').attr('class', 'crosshairs');

        this.crosshairs = {
            container: crosshairs,
            shadow: crosshairs.append('g').attr('class', 'crosshair shadow'),
            main: crosshairs.append('g').attr('class', 'crosshair main')
        };

        this.flags = {
            shadow: this.flag(this.crosshairs.shadow),
            main: this.flag(this.crosshairs.main)
        };

        this.dots = {
            shadow: this.crosshairs.shadow.append('rect').classed('value', true).attr('x', (FLAG_WIDTH - 5) / 2).attr('width', 5).attr('height', 5),
            main: this.crosshairs.main.append('rect').classed('value', true).attr('x', (FLAG_WIDTH - 5) / 2).attr('width', 5).attr('height', 5)
        };

        this.hairs = {
            shadow: this.crosshairs.shadow.append('line').attr('x1', FLAG_WIDTH / 2).attr('x2', FLAG_WIDTH / 2),
            main: this.crosshairs.main.append('line').attr('x1', FLAG_WIDTH / 2).attr('x2', FLAG_WIDTH / 2)
        };

        this.chart.call(d3.zoom().scaleExtent([SCALE_EXTENT, Infinity]).on('zoom', this.zoom()));
        this.chart.on('mousemove', this.mousemove());

        this.resizeObserver = new ResizeObserver(this.resize.bind(this));
        this.resizeObserver.observe(this.refs.chart);

        this.resize();
    }

    mousemove(){
        const _this = this;

        return function(d, i){
            //TODO move the drawing portion of this function elsewhere to allow for programmatic access
            let [x, y] = d3.mouse(this);
            let left = (x < (_this.width / 2));

            _this.cursor = x;

            _this.crosshairs.main.attr('transform', `translate(${x - (FLAG_WIDTH - 1) / 2}, 0)`)
                .classed('bids', left)
                .classed('asks', !left)
                .select('text')
                    .text('00.00');

            _this.crosshairs.shadow.attr('transform', `translate(${(_this.width - x) - (FLAG_WIDTH - 1) / 2}, 0)`)
                .classed('bids', !left)
                .classed('asks', left)
                .select('text')
                    .text('00.00');

            _this.updateCrosshairValues();
        };
    }

    zoomBy(factor = 2){
        if(!factor) return;

        this.transform.k = Math.max(this.transform.k * factor, SCALE_EXTENT);
        this.transform.x = (this.width - this.width * this.transform.k) / 2;

        this.scale.x.domain(this.transform.rescaleX(this.basis.x).domain());
        this.draw();
    }

    zoom(){
        const _this = this;

        return function(d, i){
            d3.event.transform.x = (_this.width - _this.width * d3.event.transform.k) / 2;
            _this.transform = d3.event.transform;
            _this.scale.x.domain(d3.event.transform.rescaleX(_this.basis.x).domain());
            _this.draw();
        };
    }

    resize(){
        this.width = this.refs.chart.clientWidth;
        this.height = this.refs.chart.clientHeight;

        this.chart.attr('width', this.width);
        this.chart.attr('height', this.height);

        if(this.transform){
            this.transform.x = (this.width - this.width * this.transform.k) / 2;
            this.scale.x.domain(this.transform.rescaleX(this.basis.x).domain());
        }

        this.basis.x.range([0, this.width]);
        this.scale.x.range([0, this.width]);

        this.basis.y.range([0, this.height - AXIS_HEIGHT]);
        this.scale.y.range([0, this.height - AXIS_HEIGHT]);

        this.flags.shadow.attr('transform', `translate(0, ${this.height - AXIS_HEIGHT})`);
        this.flags.main.attr('transform', `translate(0, ${this.height - AXIS_HEIGHT})`);

        this.hairs.main.attr('y1', this.height - AXIS_HEIGHT);
        this.hairs.shadow.attr('y1', this.height - AXIS_HEIGHT);

        this.footer.attr('width', this.width).attr('transform', `translate(0, ${this.height - AXIS_HEIGHT})`);
        this.axis.bottom.element.attr('transform', `translate(0, ${this.height - AXIS_HEIGHT})`);
        this.axis.right.element.attr('transform', `translate(${this.width}, 0)`);

        this.clip.attr('width', this.width).attr('height', Math.max(this.height - AXIS_HEIGHT + 1, 0));

        this.draw();
        this.emitter.emit('did-resize', {width: this.width, height: this.height});
    }

    render(){
        return $.div({classList: 'depth', tabIndex: -1},
            $.div({classList: 'depth-tools toolbar'},
                $.div({classList: 'symbol toolbar-button', onClick: this.change.bind(this)},
                    this.market ? this.market.name : 'Select Market'
                )
            ),
            $.div({classList: 'header'},
                $.div({classList: 'bids'},
                    'Sell',
                    $.span({ref: 'bb'}, this.market ? `0.00 ${this.market.base}` : '0.00'),
                    'For',
                    $.span({ref: 'bq'}, this.market ? `0.00 ${this.market.quote}` : '0.00')
                ),
                $.div({classList: 'market'},
                    $.div({classList: 'price', ref: 'mid'}, '00.00'),
                    $.div({classList: 'label'}, 'Mid Market Price')
                ),
                $.div({classList: 'asks'},
                    'Buy',
                    $.span({ref: 'ab'}, this.market ? `0.00 ${this.market.base}` : '0.00'),
                    'For',
                    $.span({ref: 'aq'}, this.market ? `0.00 ${this.market.quote}` : '0.00')
                )
            ),
            $.div({classList: 'depth-chart', ref: 'chart'})
        );
    }

    change(){
        if(!this.omnibar) return;

        this.omnibar.search({
            name: 'Change Depth Chart Market',
            placeholder: 'Search For a Market to Display on the Depth Chart...',
            didConfirmSelection: this.changeMarket.bind(this),
            maxResultsPerCategory: 30,
            items: via.markets.all()
        });
    }

    update(){}

    data(){
        let spread = this.orderbook.spread();
        let bid = this.orderbook.max();
        this.mid = (bid + spread / 2);
        this.refs.mid.textContent = this.mid.toFixed(this.market.precision.price);

        this.draw();
    }

    draw(){
        let bids = [];
        let asks = [];
        let item;
        let base = 0;
        let quote = 0;

        let band = this.mid * this.tolerance;
        let low = this.mid - band;
        let high = this.mid + band;

        this.basis.x.domain([low, high]);

        if(this.transform){
            this.scale.x.domain(this.transform.rescaleX(this.basis.x).domain());
        }else{
            this.scale.x.domain(this.basis.x.domain());
        }

        this.axis.bottom.element.call(this.axis.bottom.basis);

        let [ll, lh] = this.scale.x.domain();

        if(this.orderbook){
            let it = this.orderbook.iterator('buy');

            while((item = it.prev()) && item.price >= ll){
                base = base + item.size;
                quote = quote + (item.size * item.price);
                bids.push({price: item.price, base, quote});
            }

            bids.push({price: ll, base, quote});

            it = this.orderbook.iterator('sell');
            base = 0;
            quote = 0;

            while((item = it.next()) && item.price <= lh){
                base = base + item.size;
                quote = quote + (item.size * item.price);
                asks.push({price: item.price, base, quote});
            }

            asks.push({price: lh, base, quote});

            const bid = bids.length ? _.last(bids).base : 0;
            const ask = asks.length ? _.last(asks).base : 0;
            const max = Math.max(+bid, +ask);

            this.bids = bids;
            this.asks = asks;

            this.scale.y.domain([max * 1.05, 0]);

            this.axis.left.element.call(this.axis.left.basis);
            this.axis.right.element.call(this.axis.right.basis);

            this.paths.selectAll('path').remove();
            this.paths.append('path').classed('bids', true).datum(bids).attr('d', this.path);
            this.paths.append('path').classed('asks', true).datum(asks).attr('d', this.path);
        }

        this.updateCrosshairValues();
    }

    updateCrosshairValues(){
        let left = (this.cursor < (this.width / 2));
        let mainPrice = this.scale.x.invert(this.cursor);
        let shadowPrice = this.scale.x.invert(this.width - this.cursor);

        let bidPrice = left ? mainPrice : shadowPrice;
        let askPrice = left ? shadowPrice : mainPrice;

        let bh = {base: 0, quote: 0};
        let ah = {base: 0, quote: 0};

        if(!this.market){
            this.refs.bb.textContent = 'N/A';
            this.refs.bq.textContent = 'N/A';
            this.refs.ab.textContent = 'N/A';
            this.refs.aq.textContent = 'N/A';
            return;
        }

        for(let bid of this.bids){
            if(bid.price < bidPrice){
                break;
            }

            bh = bid;
        }

        for(let ask of this.asks){
            if(ask.price > askPrice){
                break;
            }

            ah = ask;
        }

        this.dots.main.attr('y', this.scale.y(left ? bh.base : ah.base) - 2);
        this.dots.shadow.attr('y', this.scale.y(left ? ah.base : bh.base) - 2);

        this.flags.main.select('text').text(mainPrice.toFixed(this.market.precision.price));
        this.flags.shadow.select('text').text(shadowPrice.toFixed(this.market.precision.price));

        this.hairs.main.attr('y2', this.scale.y(left ? bh.base : ah.base));
        this.hairs.shadow.attr('y2', this.scale.y(left ? ah.base : bh.base));


        this.refs.bb.textContent = bh.base.toFixed(this.market.precision.amount) + ' ' + this.market.base;
        this.refs.bq.textContent = bh.quote.toFixed(this.market.precision.price) + ' ' + this.market.quote;

        this.refs.ab.textContent = ah.base.toFixed(this.market.precision.amount) + ' ' + this.market.base;
        this.refs.aq.textContent = ah.quote.toFixed(this.market.precision.price) + ' ' + this.market.quote;
    }

    path(data){
        if(data.length < 2){
            return '';
        }

        let first = _.first(data);
        let last = _.last(data);

        return 'M ' + this.scale.x(last.price) + ' ' + this.scale.y(-3)
            + ' H ' + this.scale.x(this.mid)
            + ' V ' + this.scale.y(0)
            + data.map(d => ` H ${this.scale.x(d.price)} V ${this.scale.y(d.base)}`).join();
    }

    flag(parent){
        const flag = parent.append('g').attr('class', 'flag');

        flag.append('rect')
        .attr('x', 1)
        .attr('y', 2)
        .attr('width', FLAG_WIDTH - 1)
        .attr('height', AXIS_HEIGHT - 3);

        flag.append('text')
        .attr('x', FLAG_WIDTH / 2)
        .attr('y', AXIS_HEIGHT / 2 + 1)
        .attr('width', FLAG_WIDTH)
        .attr('height', AXIS_HEIGHT - 3)
        .attr('alignment-baseline', 'middle')
        .attr('text-anchor', 'middle');

        return flag;
    }

    destroy(){
        if(this.orderbook){
            this.orderbook.destroy();
        }

        this.draw.cancel();
        this.disposables.dispose();
        this.emitter.dispose();
        this.resizeObserver.disconnect();
        this.emitter.emit('did-destroy');
    }

    consumeActionBar(actionBar){
        this.omnibar = actionBar.omnibar;
    }

    getURI(){
        return base + (this.market ? '/' + this.market.exchange.id + '/' + this.market.symbol : '');
    }

    getTitle(){
        return this.market ? `Market Depth, ${this.market.name}` : 'Market Depth';
    }

    getMarket(){
        return this.market;
    }

    changeMarket(market){
        if(!market || market === this.market) return;

        this.market = market;
        this.bids = [];
        this.asks = [];

        if(this.orderbook){
            this.orderbook.destroy();
        }

        this.orderbook = this.market.orderbook();
        this.orderbook.onDidUpdate(this.data.bind(this));

        etch.update(this);
        this.emitter.emit('did-change-market', market);
        this.emitter.emit('did-change-title');
    }

    onDidChangeData(callback){
        return this.emitter.on('did-change-data', callback);
    }

    onDidChangeMarket(callback){
        return this.emitter.on('did-change-market', callback);
    }

    onDidDestroy(callback){
        return this.emitter.on('did-destroy', callback);
    }

    onDidResize(callback){
        return this.emitter.on('did-resize', callback);
    }

    onDidDraw(callback){
        return this.emitter.on('did-draw', callback);
    }

    onDidChangeTitle(callback){
        return this.emitter.on('did-change-title', callback);
    }
}
