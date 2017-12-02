const {Disposable, CompositeDisposable, Emitter} = require('via');
const _ = require('underscore-plus');
const BaseURI = 'via://depth';
const RBTree = require('bintrees').RBTree;
const d3 = require('d3');
const num = require('num-plus');
const {throttle} = require('frame-throttle');
const etch = require('etch');
const $ = etch.dom;

const AXIS_HEIGHT = 24;
//TODO make this a user configurable option, but it might cause lag if it's too low
const SCALE_EXTENT = 0.5;
const TOLERANCE = 0.01;
const CROSSHAIR_WIDTH = 79;

module.exports = class Depth {
    static deserialize(params){
        return new Depth(params);
    }

    serialize(){
        return {
            uri: this.uri
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
        this.mid = num('00.00');
        this.transform = null;
        this.path = this.path.bind(this);

        this.basis = {
            x: d3.scaleLinear().domain([-100, 100]),
            y: d3.scaleLinear().domain([100, 0])
        };

        this.scale = {
            x: this.basis.x.copy(),
            y: this.basis.y.copy()
        };

        this.symbol = via.symbols.findByIdentifier(this.getURI().slice(BaseURI.length + 1));
        this.emitter.emit('did-change-symbol', this.symbol);

        this.book = this.symbol.orderbook(2);
        this.disposables.add(this.book.subscribe(this.data.bind(this)));

        etch.initialize(this);

        this.chart = d3.select(this.refs.chart).append('svg');
        this.clip = this.chart.append('clipPath').attr('id', 'depth-clip').append('rect').attr('x', 0).attr('y', 0);

        this.paths = this.chart.append('g').attr('class', 'areas').attr('clip-path', 'url(#depth-clip)');

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

        let crosshairs = this.chart.append('g').attr('class', 'crosshairs');

        this.crosshairs = {
            container: crosshairs,
            shadow: crosshairs.append('g').attr('class', 'crosshair shadow'),
            main: crosshairs.append('g').attr('class', 'crosshair main')
        };

        this.crosshairs.shadow.append('rect').classed('line', true).attr('x', (CROSSHAIR_WIDTH - 1) / 2).attr('width', 1).attr('y', 1);
        this.crosshairs.main.append('rect').classed('line', true).attr('x', (CROSSHAIR_WIDTH - 1) / 2).attr('width', 1).attr('y', 1);

        this.crosshairs.shadow.append('rect').classed('label', true).attr('width', CROSSHAIR_WIDTH).attr('height', 20);
        this.crosshairs.shadow.append('rect').classed('text', true).attr('width', CROSSHAIR_WIDTH - 2).attr('height', 18).attr('x', 1).attr('y', 1);
        this.crosshairs.shadow.append('text').attr('alignment-baseline', 'middle').attr('text-anchor', 'middle').attr('x', (CROSSHAIR_WIDTH - 1) / 2).attr('y', 10);

        this.crosshairs.main.append('rect').classed('label', true).attr('width', CROSSHAIR_WIDTH).attr('height', 20);
        this.crosshairs.main.append('rect').classed('text', true).attr('width', CROSSHAIR_WIDTH - 2).attr('height', 18).attr('x', 1).attr('y', 1);
        this.crosshairs.main.append('text').attr('alignment-baseline', 'middle').attr('text-anchor', 'middle').attr('x', (CROSSHAIR_WIDTH - 1) / 2).attr('y', 10);

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

            _this.crosshairs.main.attr('transform', `translate(${x - (CROSSHAIR_WIDTH - 1) / 2}, 0)`)
                .classed('bids', left)
                .classed('asks', !left)
                .select('text')
                    .text('HELLO');

            _this.crosshairs.shadow.attr('transform', `translate(${(_this.width - x) - (CROSSHAIR_WIDTH - 1) / 2}, 0)`)
                .classed('bids', !left)
                .classed('asks', left)
                .select('text')
                    .text('HELLO');
            // d3.event.transform.x = (_this.width - _this.width * d3.event.transform.k) / 2;
            // _this.transform = d3.event.transform;
            // _this.scale.x.domain(d3.event.transform.rescaleX(_this.basis.x).domain());
            // _this.draw();
        };
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

        this.basis.x.range([0, this.width]);
        this.scale.x.range([0, this.width]);

        this.basis.y.range([0, this.height - AXIS_HEIGHT]);
        this.scale.y.range([0, this.height - AXIS_HEIGHT]);

        this.axis.bottom.element.attr('transform', `translate(0, ${this.height - AXIS_HEIGHT})`);
        this.axis.right.element.attr('transform', `translate(${this.width}, 0)`);

        this.clip.attr('width', this.width).attr('height', Math.max(this.height - AXIS_HEIGHT + 1, 0));

        this.crosshairs.container.selectAll('.line').attr('height', Math.max(this.height - AXIS_HEIGHT - 1, 0));
        // this.crosshairs.container.selectAll('.label').attr('y', this.height - AXIS_HEIGHT + 1);

        this.draw();
        this.emitter.emit('did-resize', {width: this.width, height: this.height});
    }

    render(){
        return $.div({classList: 'depth'},
            $.div({classList: 'header'},
                $.div({classList: 'bids'}, 'Bids Price'),
                $.div({classList: 'market'},
                    $.div({classList: 'price', ref: 'mid'}, '00.00'),
                    $.div({classList: 'label'}, 'Mid Market Price')
                ),
                $.div({classList: 'asks'}, 'Asks Price')
            ),
            $.div({classList: 'depth-chart', ref: 'chart'})
        );
    }

    update(){}

    data(){
        //TODO make the precision change based on the symbol
        let spread = this.book.spread();
        let bid = this.book.max();
        this.mid = bid.add(spread.div(2)).set_precision(2);
        this.refs.mid.textContent = this.mid.toString();

        this.draw();
    }

    draw(){
        let bids = [];
        let asks = [];
        let item;
        let base = num(0);
        let quote = num(0);

        let band = this.mid.mul(this.tolerance);
        let low = this.mid.sub(band);
        let high = this.mid.add(band);

        this.basis.x.domain([+low, +high]);

        if(this.transform){
            this.scale.x.domain(this.transform.rescaleX(this.basis.x).domain());
        }else{
            this.scale.x.domain(this.basis.x.domain());
        }

        let [ll, lh] = this.scale.x.domain();

        let it = this.book.iterator('buy');

        while((item = it.prev()) && item.price.gte(ll)){
            base = base.add(item.size);
            quote = quote.add(item.size.mul(item.price));
            bids.push({price: item.price, base, quote});
        }

        bids.push({price: num(ll), base, quote});

        it = this.book.iterator('sell');
        base = num(0);
        quote = num(0);

        while((item = it.next()) && item.price.lte(lh)){
            base = base.add(item.size);
            quote = quote.add(item.size.mul(item.price));
            asks.push({price: item.price, base, quote});
        }

        asks.push({price: num(lh), base, quote});

        const bid = bids.length ? _.last(bids).base : 0;
        const ask = asks.length ? _.last(asks).base : 0;
        const max = Math.max(+bid, +ask);

        this.scale.y.domain([max * 1.05, 0]);
        // console.log(bids.length, asks.length);

        this.axis.bottom.element.call(this.axis.bottom.basis);
        this.axis.left.element.call(this.axis.left.basis);
        this.axis.right.element.call(this.axis.right.basis);

        this.paths.selectAll('path').remove();
        this.paths.append('path').classed('bids', true).datum(bids).attr('d', this.path);
        this.paths.append('path').classed('asks', true).datum(asks).attr('d', this.path);
    }

    path(data){
        if(data.length < 2){
            return '';
        }

        let first = _.first(data);
        let last = _.last(data);

        return 'M ' + this.scale.x(+last.price) + ' ' + this.scale.y(-3)
            + ' H ' + this.scale.x(+this.mid)
            + ' V ' + this.scale.y(0)
            + data.map(d => ` H ${this.scale.x(+d.price)} V ${this.scale.y(+d.base)}`).join();
    }

    destroy(){
        this.draw.cancel();
        this.disposables.dispose();
        this.emitter.dispose();
        this.resizeObserver.disconnect();
        this.emitter.emit('did-destroy');
    }

    getURI(){
        return this.uri;
    }

    getIdentifier(){
        return this.getURI().slice(BaseURI.length + 1);
    }

    getTitle(){
        return 'Market Depth';
    }

    changeSymbol(symbol){
        this.symbol = symbol;
        this.emitter.emit('did-change-symbol', symbol);
    }

    onDidChangeData(callback){
        return this.emitter.on('did-change-data', callback);
    }

    onDidChangeSymbol(callback){
        return this.emitter.on('did-change-symbol', callback);
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
}
