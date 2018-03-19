const {CompositeDisposable, Disposable, Emitter} = require('via');
const base = 'via://depth';

const Depth = require('./depth');

const InterfaceConfiguration = {
    name: 'Market Depth',
    description: 'A live depth chart that visually represents the bids and offers for a given symbol.',
    command: 'depth:create-depth-chart',
    uri: base
};

class DepthPackage {
    activate(){
        this.disposables = new CompositeDisposable();
        this.emitter = new Emitter();
        this.books = [];
        this.omnibar = null;

        this.disposables.add(via.commands.add('via-workspace, .symbol-explorer .market', 'depth:create-depth-chart', this.create.bind(this)));

        this.disposables.add(via.workspace.addOpener((uri, options) => {
            if(uri === base || uri.startsWith(base + '/')){
                const depth = new Depth({uri, omnibar: this.omnibar});

                this.books.push(depth);
                this.emitter.emit('did-create-depth-chart', depth);

                return depth;
            }
        }, InterfaceConfiguration));
    }

    create(e){
        e.stopPropagation();

        if(e.currentTarget.classList.contains('market')){
            const market = e.currentTarget.getMarket();
            via.workspace.open(`${base}/${market.exchange.id}/${market.symbol}`, {});
        }else{
            via.workspace.open(base);
        }
    }

    deactivate(){
        this.disposables.dispose();
        this.disposables = null;
    }

    consumeActionBar(actionBar){
        this.omnibar = actionBar.omnibar;

        for(let book of this.book){
            book.consumeActionBar(actionBar);
        }
    }
}

module.exports = new DepthPackage();
