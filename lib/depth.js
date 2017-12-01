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
        this.tolerance = 100;
        this.draw = throttle(this.draw.bind(this));
        this.mid = num('00.00');

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

        this.axis = {
            bottom: {
                basis: d3.axisBottom(this.scale.x).tickPadding(4).tickSizeOuter(0),
                element: this.chart.append('g').attr('class', 'x axis bottom')
            },
            left: {
                basis: d3.axisRight(this.scale.y).tickSizeOuter(0),
                element: this.chart.append('g').attr('class', 'y axis left')
            },
            right: {
                basis: d3.axisLeft(this.scale.y).tickSizeOuter(0),
                element: this.chart.append('g').attr('class', 'y axis right')
            }
        };

        this.chart.call(d3.zoom().on('zoom', this.zoom()));

        this.resizeObserver = new ResizeObserver(this.resize.bind(this));
        this.resizeObserver.observe(this.refs.chart);
    }

    zoom(){
        const _this = this;

        return function(d, i){
            d3.event.transform.x = (_this.width - _this.width * d3.event.transform.k) / 2;
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

    rescale(){

    }

    draw(){
        let bids = [];
        let asks = [];
        let item;
        let base = num(0);
        let quote = num(0);

        let it = this.book.iterator('buy');

        while(bids.length < this.tolerance && (item = it.prev())){
            base = base.add(item.size);
            quote = quote.add(item.size.mul(item.price));
            bids.push({price: item.price, base, quote});
        }

        it = this.book.iterator('sell');
        base = num(0);
        quote = num(0);

        while(asks.length < this.tolerance && (item = it.next())){
            base = base.add(item.size);
            quote = quote.add(item.size.mul(item.price));
            asks.push({price: item.price, base, quote});
        }

        this.rescale();

        this.axis.bottom.element.call(this.axis.bottom.basis);
        this.axis.left.element.call(this.axis.left.basis);
        this.axis.right.element.call(this.axis.right.basis);


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
