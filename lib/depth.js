const {Disposable, CompositeDisposable, Emitter} = require('via');
const _ = require('underscore-plus');
const BaseURI = 'via://depth';
const RBTree = require('bintrees').RBTree;
const d3 = require('d3');
const num = require('num-plus');
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
        this.disposables.add(this.book.subscribe(this.draw.bind(this)));

        // this.basis = d3.scaleTime().domain([new Date(Date.now() - 864e5), new Date()]);

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
        // this.draw();
    }

    zoom(){
        const _this = this;

        return function(d, i){
            console.log(d3.event.transform);
            d3.event.transform.x = d3.event.transform.y = 0;
            _this.scale.x.domain(d3.event.transform.rescaleX(_this.basis.x).domain());
            _this.draw();
            // d3.zoom().transform(this.zoomable, event.transform);
            // _this.chart.zoomed({event: d3.event, target: _this});
            // gX.call(xAxis.scale(d3.event.transform.rescaleX(x)));
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

    rescale(){

    }

    render(){
        return $.div({classList: 'depth'},
            $.div({classList: 'header'},
                $.div({classList: 'bids'}, 'Bids Price'),
                $.div({classList: 'market'},
                    $.div({classList: 'price'}, '00.00'),
                    $.div({classList: 'label'}, 'Mid Market Price')
                ),
                $.div({classList: 'asks'}, 'Asks Price')
            ),
            $.div({classList: 'depth-chart', ref: 'chart'})
        );
    }

    update(){}

    draw(){
        // console.log('update')
        let bids = [];
        let asks = [];
        let item, last;

        this.axis.bottom.element.call(this.axis.bottom.basis);
        this.axis.left.element.call(this.axis.left.basis);
        this.axis.right.element.call(this.axis.right.basis);

        return;





        let it = this.book.iterator('buy');

        while(bids.length < this.count && (item = it.prev())){
            let price = item.price.floor(this.aggregation).set_precision(2);

            if(last && last.price.eq(price)){
                last.size = last.size.add(item.size);
            }else{
                last = {price, size: item.size};
                bids.push(last);
            }
        }

        it = this.book.iterator('sell');
        last = null;

        while(asks.length < this.count && (item = it.next())){
            let price = item.price.ceil(this.aggregation).set_precision(2);

            if(last && last.price.eq(price)){
                last.size = last.size.add(item.size);
            }else{
                last = {price, size: item.size};
                asks.push(last);
            }
        }
        // this.rescale();

        // console.log('updated', this.book.spread().floor(this.aggregation).toString());
        this.bids = bids;
        this.asks = asks.reverse();
        // etch.update(this);
        // this.bids.update(bids);
        // this.asks.update(asks);
    }

    destroy(){
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
