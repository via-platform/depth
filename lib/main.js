const {CompositeDisposable, Disposable, Emitter} = require('via');
const BaseURI = 'via://depth';

const Depth = require('./depth');

const InterfaceConfiguration = {
    name: 'Market Depth',
    description: 'A live depth chart that visually represents the bids and offers for a given symbol.',
    command: 'depth:create-depth-chart',
    uri: BaseURI
};

class DepthPackage {
    activate(){
        this.disposables = new CompositeDisposable();
        this.emitter = new Emitter();
        this.books = [];
        this.omnibar = null;

        this.disposables.add(via.commands.add('via-workspace', {
            'depth:create-depth-chart': () => via.workspace.open(BaseURI + '/GDAX:BTC-USD')
        }));

        this.disposables.add(via.workspace.addOpener((uri, options) => {
            if(uri.startsWith(BaseURI)){
                const depth = new Depth({uri, omnibar: this.omnibar});

                this.books.push(depth);
                this.emitter.emit('did-create-depth-chart', depth);

                return depth;
            }
        }, InterfaceConfiguration));
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
