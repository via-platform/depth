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
    initialize(){
        this.disposables = new CompositeDisposable();
        this.emitter = new Emitter();
        this.books = [];

        this.disposables.add(via.commands.add('via-workspace, .symbol-explorer .market', 'depth:create-depth-chart', this.create.bind(this)));

        this.disposables.add(via.workspace.addOpener((uri, options) => {
            if(uri === base || uri.startsWith(base + '/')){
                const depth = new Depth({omnibar: this.omnibar}, {uri});

                this.books.push(depth);
                this.emitter.emit('did-create-depth-chart', depth);

                return depth;
            }
        }, InterfaceConfiguration));
    }

    deserialize(state){
        const depth = Depth.deserialize({omnibar: this.omnibar}, state);
        this.books.push(depth);
        return depth;
    }

    create(e){
        e.stopPropagation();

        if(e.currentTarget.classList.contains('market')){
            via.workspace.open(`${base}/market/${e.currentTarget.market.uri()}`, {});
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

        for(const book of this.books){
            book.consumeActionBar(actionBar);
        }
    }
}

module.exports = new DepthPackage();
