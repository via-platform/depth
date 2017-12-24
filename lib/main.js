const {CompositeDisposable, Disposable, Emitter} = require('via');
const BaseURI = 'via://depth';

const Depth = require('./depth');

class DepthPackage {
    activate(){
        this.disposables = new CompositeDisposable();
        this.emitter = new Emitter();
        this.books = [];
        this.omnibar = null;

        via.commands.add('via-workspace', {
            'depth:default': () => via.workspace.open(BaseURI + '/GDAX:BTC-USD')
        });

        this.disposables.add(via.workspace.addOpener((uri, options) => {
            if(uri.startsWith(BaseURI)){
                const depth = new Depth({uri, omnibar: this.omnibar});

                this.books.push(depth);
                this.emitter.emit('did-create-depth-chart', depth);

                return depth;
            }
        }));
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
