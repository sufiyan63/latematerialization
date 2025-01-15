const cds = require('@sap/cds')

module.exports = class CatalogService extends cds.ApplicationService {
  init() {

    const { Books, Authors } = cds.entities('sap.capire.bookshop')
    const { ListOfBooks } = this.entities

    // late materialization poc
    this.on('READ', 'Books', async req => {
      const FilteredBooks = SELECT`ID,
      title,
      descr,
      author.name as authorName,
      genre.name as genreName,
      stock,
      price,
      currency,
      image from ${Books} as B where exists (select from ${Authors} as A
                  where A.ID = B.author_ID
                    and A.name is not null
                    and A.dateOfBirth is not null)`;
      const result = await req.tx.run(FilteredBooks);
      return Array.isArray(result) ? result : result[0];
    })

    this.on("FilterBooksWithAuthors", async () => {
      try {
        let dbQuery = `Call "FilterBooksWithAuthors"(filterBooks => ?)`;
        const { FILTERBOOKS } = await cds.run(dbQuery);
        cds.log().info(FILTERBOOKS);
        return FILTERBOOKS;
      } catch (error) {
        cds.log().error(error);
        return [];
      }
    })

    // Reduce stock of ordered books if available stock suffices
    this.on('submitOrder', async req => {
      let { book: id, quantity } = req.data
      let book = await SELECT.one.from(Books, id, b => b.stock)

      // Validate input data
      if (!book) return req.error(404, `Book #${id} doesn't exist`)
      if (quantity < 1) return req.error(400, `quantity has to be 1 or more`)
      if (!book.stock || quantity > book.stock) return req.error(409, `${quantity} exceeds stock for book #${id}`)

      // Reduce stock in database and return updated stock value
      await UPDATE(Books, id).with({ stock: book.stock -= quantity })
      return book
    })

    // Emit event when an order has been submitted
    this.after('submitOrder', async (_, req) => {
      let { book, quantity } = req.data
      await this.emit('OrderedBook', { book, quantity, buyer: req.user.id })
    })

    // Delegate requests to the underlying generic service
    return super.init()
  }
}
