/**
 * Durandal 2.0.0 Copyright (c) 2012 Blue Spire Consulting, Inc. All Rights Reserved.
 * Available via the MIT license.
 * see: http://durandaljs.com or https://github.com/BlueSpire/Durandal for details.
 */
define(['durandal/system', 'durandal/viewModelBinder', 'knockout'], function(system, viewModelBinder, ko) {
    var observableModule,
        toString = Object.prototype.toString,
        nonObservableTypes = ['[object Function]', '[object String]', '[object Boolean]', '[object Number]', '[object Date]', '[object RegExp]'],
        observableArrayMethods = ['remove', 'removeAll', 'destroy', 'destroyAll', 'replace'],
        arrayMethods = ['pop', 'reverse', 'sort', 'shift', 'splice'],
        additiveArrayFunctions = ['push', 'unshift'],
        arrayProto = Array.prototype,
        observableArrayFunctions = ko.observableArray.fn;

    function shouldIgnorePropertyName(propertyName){
        var first = propertyName[0];
        return first === '_' || first === '$';
    }

    function canConvertType(value) {
        if (!value || system.isElement(value) || value.ko === ko || value.jquery) {
            return false;
        }

        var type = toString.call(value);

        return nonObservableTypes.indexOf(type) == -1 && !(value === true || value === false);
    }

    function makeObservableArray(original, observable) {
        var lookup = original.__observable__, notify = true;

        if(lookup && lookup.__full__){
            return;
        }

        lookup = lookup || (original.__observable__ = {});
        lookup.__full__ = true;

        observableArrayMethods.forEach(function(methodName) {
            original[methodName] = function() {
                notify = false;
                var methodCallResult = observableArrayFunctions[methodName].apply(observable, arguments);
                notify = true;
                return methodCallResult;
            };
        });

        arrayMethods.forEach(function(methodName) {
            original[methodName] = function() {
                if(notify){
                    observable.valueWillMutate();
                }

                var methodCallResult = arrayProto[methodName].apply(original, arguments);

                if(notify){
                    observable.valueHasMutated();
                }

                return methodCallResult;
            };
        });

        additiveArrayFunctions.forEach(function(methodName){
            original[methodName] = function() {
                for (var i = 0, len = arguments.length; i < len; i++) {
                    convertObject(arguments[i]);
                }

                if(notify){
                    observable.valueWillMutate();
                }

                var methodCallResult = arrayProto[methodName].apply(original, arguments);

                if(notify){
                    observable.valueHasMutated();
                }

                return methodCallResult;
            };
        });

        original['splice'] = function() {
            for (var i = 2, len = arguments.length; i < len; i++) {
                convertObject(arguments[i]);
            }

            if(notify){
                observable.valueWillMutate();
            }

            var methodCallResult = arrayProto['splice'].apply(original, arguments);

            if(notify){
                observable.valueHasMutated();
            }

            return methodCallResult;
        };

        for (var i = 0, len = original.length; i < len; i++) {
            convertObject(original[i]);
        }
    }

    function convertObject(obj){
        var lookup, value;

        if(!canConvertType(obj)){
            return;
        }

        lookup = obj.__observable__;

        if(lookup && lookup.__full__){
            return;
        }

        lookup = lookup || (obj.__observable__ = {});
        lookup.__full__ = true;

        if (system.isArray(obj)) {
            var observable = ko.observableArray(obj);
            makeObservableArray(obj, observable);
        } else {
            for (var propertyName in obj) {
                if(shouldIgnorePropertyName(propertyName)){
                    continue;
                }

                if(!lookup[propertyName]){
                    value = obj[propertyName];

                    if(!system.isFunction(value)){
                        convertProperty(obj, propertyName, value);
                    }
                }
            }
        }

        system.log('Converted', obj);
    }

    function convertProperty(obj, propertyName, original){
        var observable,
            isArray,
            lookup = obj.__observable__ || (obj.__observable__ = {});

        if(original === undefined){
            original = obj[propertyName];
        }

        if (system.isArray(original)) {
            observable = ko.observableArray(original);
            makeObservableArray(original, observable);
            isArray = true;
        } else if (typeof original == "function") {
            if(ko.isObservable(original)){
                observable = original;
            }else{
                return null;
            }
        } else {
            observable = ko.observable(original);
            convertObject(original);
        }

        Object.defineProperty(obj, propertyName, {
            configurable: true,
            enumerable: true,
            get: observable,
            set: ko.isWriteableObservable(observable) ? (function(newValue) {
                var val;
                observable(newValue);
                val = observable.peek();

                //if this was originally an observableArray, then always check to see if we need to add/replace the array methods (if newValue was an entirely new array)
                if (isArray) {
                    if (!val.destroyAll) {
                        //don't allow null, force to an empty array
                        if (!val) {
                            val = [];
                            observable(val);
                        }

                        makeObservableArray(val, observable);
                    }
                } else {
                    convertObject(val);
                }
            }) : undefined
        });

        lookup[propertyName] = observable;
        return observable;
    }

    function defineProperty(obj, propertyName, evaluatorOrOptions) {
        var ko = this,
            computedOptions = { owner: obj, deferEvaluation: true },
            computed;

        if (typeof evaluatorOrOptions === 'function') {
            computedOptions.read = evaluatorOrOptions;
        } else {
            if ('value' in evaluatorOrOptions) {
                throw new Error('For ko.defineProperty, you must not specify a "value" for the property. You must provide a "get" function.');
            }

            if (typeof evaluatorOrOptions.get !== 'function') {
                throw new Error('For ko.defineProperty, the third parameter must be either an evaluator function, or an options object containing a function called "get".');
            }

            computedOptions.read = evaluatorOrOptions.get;
            computedOptions.write = evaluatorOrOptions.set;
        }

        computed = ko.computed(computedOptions);
        obj[propertyName] = computed;

        return convertProperty(obj, propertyName, computed);
    }

    observableModule = function(obj, propertyName){
        var lookup, observable, value;

        if (!obj) {
            return null;
        }

        lookup = obj.__observable__;
        if(lookup){
            observable = lookup[propertyName];
            if(observable){
                return observable;
            }
        }

        value = obj[propertyName];

        if(ko.isObservable(value)){
            return value;
        }

        return convertProperty(obj, propertyName, value);
    };

    observableModule.defineProperty = defineProperty;
    observableModule.convertProperty = convertProperty;
    observableModule.convertObject = convertObject;
    observableModule.install = function() {
        var original = viewModelBinder.beforeBind;

        if(original === system.noop){
            viewModelBinder.beforeBind = convertObject;
        }else{
            viewModelBinder.beforeBind = function(obj, view) {
                convertObject(obj);
                original(obj, view);
            };
        }
    };

    return observableModule;
});
