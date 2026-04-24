export type ObjectSchema = any;

export const BSON = {
  ObjectId: class ObjectId {
    private value: string;

    constructor(value?: string) {
      this.value =
        value ??
        `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    }

    toHexString() {
      return this.value;
    }

    toString() {
      return this.value;
    }
  },
};

class RealmObject {}

const Realm = {
  Object: RealmObject,
  BSON,
};

export default Realm;